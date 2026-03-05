import { TRPCError } from "@trpc/server";
import { hashPassword } from "better-auth/crypto";
import crypto from "crypto";
import { z } from "zod";
import { env } from "~/env";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import {
	getPasswordChangedAlertTemplate,
	getPasswordResetEmailTemplate,
	getVerificationEmailTemplate,
} from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";

import { getAppSettings } from "~/server/services/settings";

const MAX_RATE_LIMIT_ENTRIES = 10_000;
let rateLimitCleanupCounter = 0;

const rateLimitMap = new Map<string, { count: number; lastReset: number }>();

function cleanupRateLimitMap(windowMs: number) {
	const now = Date.now();
	for (const [key, record] of rateLimitMap) {
		if (now - record.lastReset > windowMs) {
			rateLimitMap.delete(key);
		}
	}
	// If still over capacity after TTL eviction, evict oldest entries
	if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
		const entries = [...rateLimitMap.entries()].sort(
			(a, b) => a[1].lastReset - b[1].lastReset,
		);
		const toRemove = rateLimitMap.size - MAX_RATE_LIMIT_ENTRIES;
		for (let i = 0; i < toRemove; i++) {
			rateLimitMap.delete(entries[i]![0]);
		}
	}
}

function getClientIp(headers: Headers): string {
	const forwarded = headers.get("x-forwarded-for");
	if (forwarded) {
		// Use the last IP in the chain (closest to the reverse proxy)
		const ips = forwarded.split(",").map((ip) => ip.trim());
		return ips[ips.length - 1] ?? "unknown";
	}
	return headers.get("x-real-ip") ?? "unknown";
}

function checkRateLimit(key: string, limit: number, windowMs: number) {
	// Periodic cleanup every 100 calls
	rateLimitCleanupCounter++;
	if (rateLimitCleanupCounter % 100 === 0) {
		cleanupRateLimitMap(windowMs);
	}

	const now = Date.now();
	const record = rateLimitMap.get(key);
	if (!record) {
		rateLimitMap.set(key, { count: 1, lastReset: now });
		return true;
	}
	if (now - record.lastReset > windowMs) {
		record.count = 1;
		record.lastReset = now;
		return true;
	}
	if (record.count >= limit) {
		return false;
	}
	record.count++;
	return true;
}

export const authRouter = createTRPCRouter({
	getAppFeatures: publicProcedure.query(async () => {
		const settings = await getAppSettings();
		const isSmtpConfigured = !!env.SMTP_HOST;
		return {
			isEmailEnabled: isSmtpConfigured && settings.enableEmail,
			isSmtpConfigured,
		};
	}),

	verifyEmail: publicProcedure
		.input(
			z.object({
				token: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!checkRateLimit(`verifyEmail_${clientIp}`, 10, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const settings = await getAppSettings();
			if (!env.SMTP_HOST || !settings.enableEmail) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Email functionality is disabled",
				});
			}

			const { db } = ctx;

			const verificationToken = await db.verificationToken.findFirst({
				where: { token: input.token, expires: { gt: new Date() } },
			});

			if (!verificationToken) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invalid or expired token",
				});
			}

			await db.user.update({
				where: { email: verificationToken.identifier },
				data: { emailVerified: true },
			});

			await db.verificationToken.delete({
				where: { token: input.token },
			});

			return { success: true };
		}),

	requestPasswordReset: publicProcedure
		.input(
			z.object({
				email: z
					.string()
					.email()
					.max(255)
					.transform((v) => v.toLowerCase().trim()),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!checkRateLimit(`requestReset_${clientIp}`, 5, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const settings = await getAppSettings();
			if (!env.SMTP_HOST || !settings.enableEmail) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Email functionality is disabled",
				});
			}

			const { db } = ctx;

			const user = await db.user.findUnique({
				where: { email: input.email },
			});

			if (!user || !env.SMTP_HOST || !settings.enableEmail) {
				// Run dummy hash to mitigate timing attacks
				await hashPassword(crypto.randomBytes(32).toString("hex"));
				return { success: true }; // Generic success to prevent enumeration
			}

			const token = crypto.randomBytes(32).toString("hex");
			const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

			// Invalidate any existing reset tokens for this user
			await db.passwordResetToken.deleteMany({
				where: { identifier: user.email },
			});

			await db.passwordResetToken.create({
				data: {
					identifier: user.email,
					token,
					expires,
				},
			});

			const resetUrl = `${env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/reset-password?token=${token}`;
			const htmlContent = getPasswordResetEmailTemplate(resetUrl);

			await sendEmail(
				user.email,
				"Reset your Retrospend Password",
				htmlContent,
			);

			return { success: true };
		}),

	resetPassword: publicProcedure
		.input(
			z.object({
				token: z.string().min(1).max(255),
				newPassword: z
					.string()
					.min(8)
					.max(255)
					.regex(
						/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
						"Password must contain at least one uppercase letter, one lowercase letter, and one number",
					),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!checkRateLimit(`resetPassword_${clientIp}`, 5, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const { db } = ctx;

			const resetToken = await db.passwordResetToken.findFirst({
				where: { token: input.token, expires: { gt: new Date() } },
			});

			if (!resetToken) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invalid or expired token",
				});
			}

			const user = await db.user.findUnique({
				where: { email: resetToken.identifier },
			});

			if (!user) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found",
				});
			}

			const hashedPassword = await hashPassword(input.newPassword);

			await db.account.updateMany({
				where: {
					userId: user.id,
					providerId: "credential",
				},
				data: {
					password: hashedPassword,
				},
			});

			// Invalidate all existing sessions — password was compromised or reset
			await db.session.deleteMany({
				where: { userId: user.id },
			});

			await db.passwordResetToken.delete({
				where: { token: input.token },
			});

			const settings = await getAppSettings();
			if (env.SMTP_HOST && settings.enableEmail) {
				const htmlContent = getPasswordChangedAlertTemplate();

				sendEmail(
					user.email,
					"Security Alert: Your Retrospend Password was Changed",
					htmlContent,
				).catch((error) =>
					console.error("Failed to send security alert:", error),
				);
			}

			return { success: true };
		}),

	resendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		const clientIp = getClientIp(ctx.headers);
		if (!checkRateLimit(`resendVerify_${clientIp}`, 3, 60_000)) {
			throw new TRPCError({
				code: "TOO_MANY_REQUESTS",
				message: "Rate limit exceeded. Please try again later.",
			});
		}

		const user = await db.user.findUnique({
			where: { id: session.user.id },
		});

		const settings = await getAppSettings();
		if (
			!user ||
			user.emailVerified ||
			!env.SMTP_HOST ||
			!settings.enableEmail
		) {
			return { success: true };
		}

		// Clear existing tokens
		await db.verificationToken.deleteMany({
			where: { identifier: user.email },
		});

		// Generate verification token
		const token = crypto.randomBytes(32).toString("hex");
		const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

		// Insert into VerificationToken table
		await db.verificationToken.create({
			data: {
				identifier: user.email,
				token,
				expires,
			},
		});

		// Dispatch email
		const verifyUrl = `${env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/verify?token=${token}`;
		const htmlContent = getVerificationEmailTemplate(verifyUrl);

		await sendEmail(user.email, "Verify your Retrospend Account", htmlContent);

		return { success: true };
	}),
});

import { newPasswordSchema } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import { hashPassword } from "better-auth/crypto";
import crypto from "crypto";
import { z } from "zod";
import { env } from "~/env";
import { CURRENT_POLICY_VERSION } from "~/lib/policy-version";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { emailSubject } from "~/server/email-copy";
import {
	getPasswordChangedAlertTemplate,
	getVerificationEmailTemplate,
} from "~/server/email-templates";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { getClientIp, InMemoryRateLimiter } from "~/server/lib/rate-limiter";
import { hashToken } from "~/server/lib/tokens";
import { sendEmail } from "~/server/mailer";
import {
	resetPasswordHash,
	storeEmailVerificationToken,
} from "~/server/services/account-security.service";
import {
	mayGetResetLink,
	sendResetLink,
} from "~/server/services/auth/reset-request";
import {
	allowResetRequest,
	InvalidResetTokenError,
	lookupResetToken,
} from "~/server/services/auth/reset-tokens";
import { migrateGuestDataForVerifiedUser } from "~/server/services/guest-migration.service";
import { endAllSessions } from "~/server/services/protection-keys/password-writes";
import { applyConfirmedEmail } from "~/server/services/profile.service";

const rateLimiter = new InMemoryRateLimiter();

export const authRouter = createTRPCRouter({
	getAppFeatures: publicProcedure.query(async () => {
		return {
			isEmailEnabled: await isEmailDeliveryEnabled(),
			isSmtpConfigured: !!env.SMTP_HOST,
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
			if (!rateLimiter.check(`verifyEmail_${clientIp}`, 10, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			// No "email disabled" guard here: a token only exists if a mail was
			// sent, and redeeming it proves ownership even if an admin has since
			// turned email off. Refusing would strand those users unverified.
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

			const verifiedUser = await db.user.update({
				where: { email: verificationToken.identifier },
				data: { emailVerified: true },
				select: { id: true },
			});

			await db.verificationToken.delete({
				where: { token: input.token },
			});

			// Email ownership is now proven: absorb guest sessions and ghosts that
			// were waiting on this address. Best-effort, never throws.
			await migrateGuestDataForVerifiedUser(db, verifiedUser.id, {
				ipAddress: clientIp,
				userAgent: ctx.headers.get("user-agent") ?? undefined,
			});

			return { success: true };
		}),

	requestPasswordReset: publicProcedure
		.input(
			z.object({
				email: z
					.email()
					.max(255)
					.transform((v) => v.toLowerCase().trim()),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`requestReset_${clientIp}`, 5, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			if (!(await isEmailDeliveryEnabled())) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Email functionality is disabled",
				});
			}

			const { db } = ctx;

			// Counted before the lookup, for every address, so the limit and the
			// answer say nothing about whether an account exists. A refused
			// request answers like any other and sends nothing.
			const allowed = await allowResetRequest(input.email);
			const user = allowed
				? await db.user.findUnique({ where: { email: input.email } })
				: null;

			// Every path runs the same single hash, so the request takes about as long
			// for a known address as for an unknown, protected or used-up one.
			await hashPassword(crypto.randomBytes(32).toString("hex"));

			// Whether a link goes out is reset-request.ts's rule; a refusal, no
			// account and a used-up address limit answer alike.
			if (!user || !(await mayGetResetLink(user))) return { success: true };

			// Earlier live links stay valid: a request from a stranger who knows
			// the address must not cancel the person's own.
			await sendResetLink(user);

			return { success: true };
		}),

	resetPassword: publicProcedure
		.input(
			z.object({
				token: z.string().min(1).max(255),
				newPassword: newPasswordSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`resetPassword_${clientIp}`, 5, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const { db } = ctx;

			// The token belongs to a user id, whatever the address is now.
			const resetToken = await lookupResetToken(input.token);
			if (!resetToken) throw new InvalidResetTokenError();

			const user = await db.user.findUnique({
				where: { id: resetToken.userId },
			});

			if (!user) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found",
				});
			}

			const hashedPassword = await hashPassword(input.newPassword);

			await resetPasswordHash({
				userId: user.id,
				hashed: hashedPassword,
				by: { kind: "email" },
				token: input.token,
				whenNoCredential: "continue",
			});

			if (await isEmailDeliveryEnabled()) {
				const htmlContent = getPasswordChangedAlertTemplate();

				sendEmail(user.email, emailSubject.passwordChanged, htmlContent).catch(
					(error) => console.error("Failed to send security alert:", error),
				);
			}

			return { success: true, email: user.email };
		}),

	/**
	 * Records the user's consent to the Terms of Service and Privacy Policy.
	 * Called immediately after signup when NEXT_PUBLIC_ENABLE_LEGAL_PAGES is enabled.
	 */
	recordConsent: protectedProcedure
		.input(
			z.object({
				consentVersion: z.string().min(1).max(20),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session, headers } = ctx;
			const ip = getClientIp(headers);

			await db.user.update({
				where: { id: session.user.id },
				data: {
					consentedAt: new Date(),
					consentVersion: input.consentVersion,
					consentIp: ip === "unknown" ? null : ip,
				},
				select: { id: true },
			});

			return { success: true };
		}),

	resendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		const clientIp = getClientIp(ctx.headers);
		if (!rateLimiter.check(`resendVerify_${clientIp}`, 3, 60_000)) {
			throw new TRPCError({
				code: "TOO_MANY_REQUESTS",
				message: "Rate limit exceeded. Please try again later.",
			});
		}

		const user = await db.user.findUnique({
			where: { id: session.user.id },
			select: { email: true, emailVerified: true },
		});

		if (!user || user.emailVerified || !(await isEmailDeliveryEnabled())) {
			return { success: true };
		}

		const token = crypto.randomBytes(32).toString("hex");
		const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours
		await storeEmailVerificationToken(user.email, token, expires);

		// Dispatch email
		const verifyUrl = `${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/verify?token=${token}`;
		const htmlContent = getVerificationEmailTemplate(verifyUrl);

		await sendEmail(user.email, emailSubject.verifyEmail, htmlContent);

		return { success: true };
	}),

	confirmEmailChange: publicProcedure
		.input(
			z.object({
				token: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`confirmEmailChange_${clientIp}`, 10, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const { db } = ctx;
			const hashedToken = hashToken(input.token);

			const user = await db.user.findFirst({
				where: {
					pendingEmailToken: hashedToken,
					pendingEmailExpiresAt: { gt: new Date() },
				},
			});

			if (!user || !user.pendingEmail) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invalid or expired token",
				});
			}

			// Race condition: check if the pending email was taken since the request
			const emailTaken = await db.user.findUnique({
				where: { email: user.pendingEmail },
			});
			if (emailTaken) {
				await db.user.update({
					where: { id: user.id },
					data: {
						pendingEmail: null,
						pendingEmailToken: null,
						pendingEmailExpiresAt: null,
					},
				});
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"This email is already in use by another account. The change has been cancelled.",
				});
			}

			const oldEmail = user.email;
			const newEmail = user.pendingEmail;

			await applyConfirmedEmail(db, user.id, oldEmail, newEmail);

			// Clean up any old verification tokens
			await db.verificationToken
				.deleteMany({
					where: { identifier: oldEmail },
				})
				.catch(() => {});

			// The new address is verified: pick up guest sessions and ghosts
			// that were created for it. Best-effort, never throws.
			await migrateGuestDataForVerifiedUser(db, user.id, {
				ipAddress: clientIp,
				userAgent: ctx.headers.get("user-agent") ?? undefined,
			});

			return { success: true };
		}),

	revertEmailChange: publicProcedure
		.input(
			z.object({
				token: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!rateLimiter.check(`revertEmailChange_${clientIp}`, 10, 60000)) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			}

			const { db } = ctx;
			const hashedToken = hashToken(input.token);

			// No expiry check - the old email owner should always be able to revert
			const user = await db.user.findFirst({
				where: { pendingEmailToken: hashedToken },
			});

			if (!user) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invalid or already used token",
				});
			}

			// Clear the pending email change
			await db.user.update({
				where: { id: user.id },
				data: {
					pendingEmail: null,
					pendingEmailToken: null,
					pendingEmailExpiresAt: null,
				},
			});

			// Invalidate all sessions for security (attacker may have the password)
			await endAllSessions(db, user.id);

			return { success: true, email: user.email };
		}),
});

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import crypto from "crypto";
import { headers } from "next/headers";
import { env } from "~/env";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import { db } from "~/server/db";
import { getVerificationEmailTemplate } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { logEventAsync } from "~/server/services/audit.service";
import { isInviteOnlyEnabled } from "~/server/services/settings";

// ── Rate limiting for auth endpoints ──────────────────────────────────
const authRateLimitMap = new Map<
	string,
	{ count: number; lastReset: number }
>();
let authRateLimitCleanupCounter = 0;

function checkAuthRateLimit(
	key: string,
	limit: number,
	windowMs: number,
): boolean {
	authRateLimitCleanupCounter++;
	if (authRateLimitCleanupCounter % 100 === 0) {
		const now = Date.now();
		for (const [k, v] of authRateLimitMap) {
			if (now - v.lastReset > windowMs) authRateLimitMap.delete(k);
		}
		if (authRateLimitMap.size > 10_000) {
			const entries = [...authRateLimitMap.entries()].sort(
				(a, b) => a[1].lastReset - b[1].lastReset,
			);
			for (let i = 0; i < authRateLimitMap.size - 10_000; i++) {
				authRateLimitMap.delete(entries[i]![0]);
			}
		}
	}

	const now = Date.now();
	const record = authRateLimitMap.get(key);
	if (!record) {
		authRateLimitMap.set(key, { count: 1, lastReset: now });
		return true;
	}
	if (now - record.lastReset > windowMs) {
		record.count = 1;
		record.lastReset = now;
		return true;
	}
	if (record.count >= limit) return false;
	record.count++;
	return true;
}

function getClientIp(headersList: Headers): string {
	const forwarded = headersList.get("x-forwarded-for");
	if (forwarded) {
		const ips = forwarded.split(",").map((ip) => ip.trim());
		return ips[ips.length - 1] ?? "unknown";
	}
	return headersList.get("x-real-ip") ?? "unknown";
}

// Paths that should be rate-limited (login, signup, 2FA)
const RATE_LIMITED_AUTH_PATHS = [
	"/sign-in",
	"/sign-up",
	"/two-factor",
	"/forgot-password",
	"/reset-password",
];
const AUTH_RATE_LIMIT = 10; // requests per window
const AUTH_RATE_WINDOW_MS = 60_000; // 1 minute

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(db, {
		provider: "postgresql", // or "sqlite" or "mysql"
	}),
	trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // Refresh daily
	},
	emailAndPassword: {
		enabled: true,
	},
	hooks: {
		before: async (context) => {
			if (!context.request) return;
			const path = new URL(context.request.url).pathname.replace(
				/^\/api\/auth/,
				"",
			);
			if (RATE_LIMITED_AUTH_PATHS.some((p) => path.startsWith(p))) {
				const ip = getClientIp(context.request.headers);
				if (
					!checkAuthRateLimit(
						`auth_${path}_${ip}`,
						AUTH_RATE_LIMIT,
						AUTH_RATE_WINDOW_MS,
					)
				) {
					throw new APIError("TOO_MANY_REQUESTS", {
						message: "Rate limit exceeded. Please try again later.",
					});
				}
			}
		},
	},
	onAPIError: {
		onError: (error) => {
			// Log failed authentication attempts
			if (
				error &&
				typeof error === "object" &&
				"status" in error &&
				error.status === "UNAUTHORIZED"
			) {
				logEventAsync({
					eventType: "FAILED_LOGIN",
					metadata: {
						reason:
							"message" in error && typeof error.message === "string"
								? error.message
								: "Unknown error",
					},
				});
			}
		},
	},
	user: {
		additionalFields: {
			username: {
				type: "string",
				required: true,
			},
			role: {
				type: "string",
				required: true,
				defaultValue: "USER",
			},
			isActive: {
				type: "boolean",
				required: true,
				defaultValue: true,
			},
		},
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					// Normalize username to lowercase
					if (user.username) {
						user.username = (user.username as string).toLowerCase();
					}

					// Check if username is already taken
					if (user.username) {
						const existingUsername = await db.user.findUnique({
							where: { username: user.username as string },
						});
						if (existingUsername) {
							throw new APIError("BAD_REQUEST", {
								message: "Username is already taken",
							});
						}
					}

					// Check if invite-only mode is enabled
					const inviteOnlyEnabled = await isInviteOnlyEnabled();

					if (inviteOnlyEnabled) {
						// Check invite code for new users
						const headersList = await headers();
						const inviteCode = headersList
							.get("cookie")
							?.split(";")
							.find((c) => c.trim().startsWith("retro_invite_code="))
							?.split("=")[1];

						if (!inviteCode) {
							throw new Error("Invite code required for new users");
						}

						// Verify invite code exists, is active, and unused
						const validInvite = await db.inviteCode.findFirst({
							where: {
								code: inviteCode,
								isActive: true,
								usedById: null,
								OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
							},
						});

						if (!validInvite) {
							throw new Error("Invalid or expired invite code");
						}
					}
				},
				after: async (user) => {
					// Check if invite-only mode is enabled
					const inviteOnlyEnabled = await isInviteOnlyEnabled();

					let inviteCode: string | undefined;
					if (inviteOnlyEnabled) {
						// Mark invite code as used
						const headersList = await headers();
						inviteCode = headersList
							.get("cookie")
							?.split(";")
							.find((c) => c.trim().startsWith("retro_invite_code="))
							?.split("=")[1];

						if (inviteCode) {
							// Atomic conditional update to prevent TOCTOU race conditions
							const result = await db.$executeRaw`
								UPDATE "invite_code"
								SET "usedById" = ${user.id}, "usedAt" = NOW(), "isActive" = false
								WHERE "code" = ${inviteCode} AND "usedById" IS NULL AND "isActive" = true
							`;
							if (result === 0) {
								console.warn(
									`Invite code ${inviteCode} was already consumed (race condition) for user ${user.id}`,
								);
							}
						}
					}

					// First Born Logic: Promote first user to ADMIN
					const userCount = await db.user.count();
					if (userCount === 1) {
						await db.user.update({
							where: { id: user.id },
							data: { role: "ADMIN" },
						});
					}

					// Seed default categories for the new user
					await db.category.createMany({
						data: DEFAULT_CATEGORIES.map((category) => ({
							name: category.name,
							color: category.color,
							userId: user.id,
						})),
					});

					// Email Verification Logic
					if (!env.SMTP_HOST) {
						// Bypass verification if SMTP is not configured
						await db.user.update({
							where: { id: user.id },
							data: { emailVerified: true },
						});
					} else {
						// Ensure emailVerified is null
						await db.user.update({
							where: { id: user.id },
							data: { emailVerified: false },
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

						await sendEmail(
							user.email,
							"Verify your Retrospend Account",
							htmlContent,
						);
					}

					// Log account creation and invite usage
					const headersList = await headers();
					const ipAddress = headersList.get("x-forwarded-for") ?? undefined;
					const userAgent = headersList.get("user-agent") ?? undefined;

					logEventAsync({
						eventType: "ACCOUNT_CREATED",
						userId: user.id,
						ipAddress,
						userAgent,
						metadata: {
							username: user.username as string,
							email: user.email,
							role: user.role as string,
						},
					});

					// Log invite usage if invite code was used
					if (inviteCode) {
						logEventAsync({
							eventType: "INVITE_USED",
							userId: user.id,
							ipAddress,
							userAgent,
							metadata: {
								inviteCode,
								username: user.username as string,
								email: user.email,
							},
						});
					}
				},
			},
		},
		session: {
			create: {
				before: async (session) => {
					// Kill Switch Logic: Block sign-in for inactive users
					const user = await db.user.findUnique({
						where: { id: session.userId },
						select: { isActive: true },
					});

					if (!user?.isActive) {
						throw new Error("Account is deactivated");
					}
				},
				after: async (session) => {
					// Log successful login
					const headersList = await headers();
					logEventAsync({
						eventType: "SUCCESSFUL_LOGIN",
						userId: session.userId,
						ipAddress:
							session.ipAddress ??
							headersList.get("x-forwarded-for") ??
							undefined,
						userAgent:
							session.userAgent ?? headersList.get("user-agent") ?? undefined,
						metadata: {
							sessionId: session.id,
						},
					});
				},
			},
		},
	},
	plugins: [
		twoFactor({
			issuer: "Retrospend",
		}),
	],
	baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:1997",
});

type InferredSession = typeof auth.$Infer.Session;
export type Session = {
	session: InferredSession["session"];
	user: InferredSession["user"] & {
		username: string;
		role: string;
		isActive: boolean;
	};
};

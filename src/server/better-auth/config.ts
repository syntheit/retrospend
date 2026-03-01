import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import crypto from "crypto";
import { headers } from "next/headers";
import { env } from "~/env";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import { db } from "~/server/db";
import { sendEmail } from "~/server/mailer";
import { isInviteOnlyEnabled } from "~/server/services/settings";
import { logEventAsync } from "~/server/services/audit.service";

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(db, {
		provider: "postgresql", // or "sqlite" or "mysql"
	}),
	trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
	emailAndPassword: {
		enabled: true,
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
							await db.inviteCode.updateMany({
								where: { code: inviteCode },
								data: {
									usedAt: new Date(),
									isActive: false,
									usedById: user.id,
								},
							});
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
						await sendEmail(
							user.email,
							"Verify your Retrospend Account",
							`<p>Welcome to Retrospend! Click the link below to verify your email address:</p><a href="${verifyUrl}">Verify Email</a>`,
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
							session.ipAddress ?? headersList.get("x-forwarded-for") ?? undefined,
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

export type Session = typeof auth.$Infer.Session;

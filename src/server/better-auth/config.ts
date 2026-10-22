import { apiKey } from "@better-auth/api-key";
import { expo } from "@better-auth/expo";
import { parseScopeList } from "@retrospend/api-contract/common";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, deviceAuthorization, twoFactor } from "better-auth/plugins";
import crypto from "crypto";
import { headers } from "next/headers";
import { env } from "~/env";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import {
	DEFAULT_TOKEN_SCOPES,
	DEVICE_CLIENT_IDS,
	formatScopeList,
} from "~/server/api/v1/scopes";
import { db } from "~/server/db";
import { getVerificationEmailTemplate } from "~/server/email-templates";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { getClientIp, InMemoryRateLimiter } from "~/server/lib/rate-limiter";
import { sendEmail } from "~/server/mailer";
import { logEventAsync } from "~/server/services/audit.service";
import { migrateGuestDataForVerifiedUser } from "~/server/services/guest-migration.service";
import { isInviteOnlyEnabled } from "~/server/services/settings";
import { USERNAME_RESERVATION_DAYS } from "~/server/services/username.service";

// ── Rate limiting for auth endpoints ──────────────────────────────────
const authRateLimiter = new InMemoryRateLimiter();

// Paths that should be rate-limited (login, signup, 2FA)
const RATE_LIMITED_AUTH_PATHS = [
	"/sign-in",
	"/sign-up",
	"/two-factor",
	"/forgot-password",
	"/reset-password",
	"/device/code",
];
const AUTH_RATE_LIMIT = 10; // requests per window
const AUTH_RATE_WINDOW_MS = 60_000; // 1 minute

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Rejects a device authorization request for an unknown scope (RFC 8628
 * `invalid_scope`) before a code is issued.
 */
function assertKnownScopes(scope: string | undefined) {
	const { unknown } = parseScopeList(scope);
	if (unknown.length > 0) {
		throw new APIError("BAD_REQUEST", {
			error: "invalid_scope",
			error_description: `Unknown scope: ${unknown.join(" ")}`,
		});
	}
}

/**
 * Client calls to the api-key plugin may not drop a key's expiry (update
 * with `expiresIn: null`) or pick their own prefix: every key expires, and
 * /api/v1 tells a key from a session token by the rsk_ prefix.
 */
function guardApiKeyRequest(path: string, body: unknown) {
	const fields = (body ?? {}) as { expiresIn?: unknown; prefix?: unknown };
	if (path === "/api-key/update" && fields.expiresIn === null) {
		throw new APIError("BAD_REQUEST", { message: "API keys always expire" });
	}
	if (path === "/api-key/create" && fields.prefix !== undefined) {
		throw new APIError("BAD_REQUEST", { message: "API keys use the rsk_ prefix" });
	}
}

/**
 * The device token endpoint creates a plain session; this stamps it with the
 * scopes the device asked for and its client id before the token leaves the
 * server. If the update fails the request fails, so no unscoped device
 * token is ever handed out.
 */
const scopeDeviceSession = createAuthMiddleware(async (ctx) => {
	if (ctx.path !== "/device/token") return;
	const session = ctx.context.newSession?.session;
	const returned = ctx.context.returned as { scope?: string } | undefined;
	if (!session || !returned || returned instanceof Error) return;
	const requested = parseScopeList(returned.scope).scopes;
	const scopes = requested.length > 0 ? requested : DEFAULT_TOKEN_SCOPES;
	await db.session.update({
		where: { id: session.id },
		data: {
			scopes: formatScopeList(scopes),
			clientId: (ctx.body as { client_id?: string } | undefined)?.client_id,
		},
	});
});

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(db, {
		provider: "postgresql", // or "sqlite" or "mysql"
	}),
	trustedOrigins: [
		env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL,
		// The Expo app's deep-link scheme (mobile sign-in and redirects).
		"retrospend://",
		...(env.TRUSTED_ORIGINS
			? env.TRUSTED_ORIGINS.split(",")
					.map((o) => o.trim())
					.filter(Boolean)
			: []),
	],
	session: {
		expiresIn: 60 * 60 * 24 * 60, // 60 days
		updateAge: 60 * 60 * 24, // Refresh daily
		additionalFields: {
			// Set only on device-authorization sessions (scopeDeviceSession).
			scopes: { type: "string", required: false, input: false },
			clientId: { type: "string", required: false, input: false },
		},
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
					!authRateLimiter.check(
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
			guardApiKeyRequest(path, context.body);
		},
		after: scopeDeviceSession,
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

					// Validate username format (alphanumeric only)
					if (user.username && !/^[a-z0-9]+$/.test(user.username as string)) {
						throw new APIError("BAD_REQUEST", {
							message: "Username can only contain letters and numbers",
						});
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

						// Check if username is reserved by another user (within reservation period)
						const reservationCutoff = new Date();
						reservationCutoff.setDate(
							reservationCutoff.getDate() - USERNAME_RESERVATION_DAYS,
						);
						const reserved = await db.usernameHistory.findUnique({
							where: { previousUsername: user.username as string },
							select: { changedAt: true },
						});
						if (reserved && reserved.changedAt > reservationCutoff) {
							throw new APIError("BAD_REQUEST", {
								message: "Username is not available",
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
					if (!(await isEmailDeliveryEnabled())) {
						// Bypass verification if mail can't go out (no SMTP, or the
						// admin turned email off): the user could never verify.
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
						const verifyUrl = `${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/auth/verify?token=${token}`;
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

					// Absorb guest sessions and ghosts with this email, but only once
					// the email is verified. With email off it was auto-verified above;
					// otherwise this is a no-op here and runs from auth.verifyEmail.
					// The helper re-reads emailVerified and never throws.
					await migrateGuestDataForVerifiedUser(db, user.id, {
						ipAddress,
						userAgent,
					});
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
		// Mobile: `Authorization: Bearer <session token>` (token from the
		// set-auth-token header at sign-in) and the Expo origin handling.
		bearer(),
		expo(),
		// Personal access tokens for scripts and integrations: shown once,
		// stored hashed, always expiring. Scopes live in `permissions` and can
		// only be set server side; /api/v1 enforces them and rate limits keys
		// in Postgres, so the plugin's own limiter is off.
		apiKey({
			defaultPrefix: "rsk_",
			requireName: true,
			keyExpiration: {
				defaultExpiresIn: 90 * DAY_SECONDS,
				minExpiresIn: 1,
				maxExpiresIn: 365,
			},
			rateLimit: { enabled: false },
			permissions: {
				defaultPermissions: { scopes: [...DEFAULT_TOKEN_SCOPES] },
			},
		}),
		// RFC 8628 for the later CLI and desktop clients; users approve at /device.
		deviceAuthorization({
			verificationUri: "/device",
			expiresIn: "30m",
			interval: "5s",
			validateClient: (clientId) => DEVICE_CLIENT_IDS.includes(clientId),
			onDeviceAuthRequest: (_clientId, scope) => assertKnownScopes(scope),
		}),
	],
	baseURL: env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997",
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

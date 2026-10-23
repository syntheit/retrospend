import { TRPCError } from "@trpc/server";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import crypto from "crypto";
import { z } from "zod";
import { env } from "~/env";
import {
	type BackgroundSettings,
	backgroundSettingsSchema,
	defaultBackgroundSettings,
} from "~/lib/background-settings";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { db, db as globalDb } from "~/server/db";
import {
	getEmailChangeAlertTemplate,
	getEmailChangeVerificationTemplate,
} from "~/server/email-templates";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { hashToken } from "~/server/lib/tokens";
import { sendEmail } from "~/server/mailer";
import { migrateGuestDataForVerifiedUser } from "~/server/services/guest-migration.service";
import {
	getProfileBackground,
	saveProfileBackground,
} from "~/server/services/profile-background.service";
import { listedEntryWhere } from "~/server/services/spending";
import { StatsService } from "~/server/services/stats.service";
import { validateAndProcessUsernameChange } from "~/server/services/username.service";
import { getImageUrl } from "~/server/storage";

export type { BackgroundSettings };
export { defaultBackgroundSettings };

/** What profile.update returns about the user. */
const IDENTITY = { id: true, name: true, username: true, email: true } as const;

export const profileRouter = createTRPCRouter({
	getBackgroundSettings: protectedProcedure.query(({ ctx }) =>
		getProfileBackground(ctx.db, ctx.session.user.id),
	),

	saveBackgroundSettings: protectedProcedure
		.input(backgroundSettingsSchema)
		.mutation(async ({ ctx, input }) => {
			await saveProfileBackground(ctx.db, ctx.session.user.id, input);
			return { success: true };
		}),

	getMyAvatar: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			where: { id: ctx.session.user.id },
			select: { avatarPath: true, name: true },
		});
		return {
			avatarUrl: getImageUrl(user?.avatarPath ?? null),
			name: user?.name ?? "",
		};
	}),

	publicProfile: publicProcedure
		.input(z.object({ username: z.string() }))
		.query(async ({ input }) => {
			const user = await db.user.findFirst({
				where: {
					username: {
						equals: input.username,
						mode: "insensitive",
					},
				},
				select: {
					id: true,
					name: true,
					username: true,
					image: true,
					avatarPath: true,
					createdAt: true,
					pageSettings: {
						where: { page: "PROFILE" },
						select: { settings: true },
						take: 1,
					},
				},
			});

			if (!user) {
				// Check if this is a previous username that should redirect
				const historyEntry = await db.usernameHistory.findFirst({
					where: {
						previousUsername: {
							equals: input.username,
							mode: "insensitive",
						},
					},
					select: {
						user: {
							select: { username: true },
						},
					},
				});

				if (historyEntry) {
					return { redirect: historyEntry.user.username };
				}

				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found",
				});
			}

			const publicMethods = await db.paymentMethod.findMany({
				where: {
					userId: user.id,
					visibility: "PUBLIC",
				},
				orderBy: { rank: "asc" },
				select: {
					id: true,
					type: true,
					label: true,
					identifier: true,
					currency: true,
					network: true,
					rank: true,
				},
			});

			const rawBg = user.pageSettings[0]?.settings;
			const parsedBg = backgroundSettingsSchema.safeParse(rawBg);
			const backgroundSettings = parsedBg.success
				? parsedBg.data
				: defaultBackgroundSettings;

			return {
				displayName: user.name,
				username: user.username,
				avatar: getImageUrl(user.avatarPath) ?? user.image,
				memberSince: user.createdAt,
				publicMethods,
				backgroundSettings,
			};
		}),

	update: protectedProcedure
		.input(
			// Each field is optional: Settings saves one at a time, so a write
			// (or an Undo) never carries another field's older value.
			z.object({
				name: z.string().min(1, "Name is required").max(100).optional(),
				username: z
					.string()
					.min(1, "Username is required")
					.max(50)
					.regex(
						/^[a-zA-Z0-9]+$/,
						"Username can only contain letters and numbers",
					)
					.transform((v) => v.toLowerCase())
					.optional(),
				email: z
					.email("Invalid email address")
					.max(254)
					.transform((v) => v.toLowerCase().trim())
					.optional(),
				currentPassword: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			if (
				input.username !== undefined &&
				input.username !== session.user.username
			) {
				await validateAndProcessUsernameChange(
					db,
					session.user.id,
					session.user.username,
					input.username,
				);
			}

			const newEmail =
				input.email !== undefined && input.email !== session.user.email
					? input.email
					: null;
			const isEmailChange = newEmail !== null;

			if (isEmailChange) {
				// Require password verification for email changes
				if (!input.currentPassword) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is required to change email",
					});
				}

				const credentialAccount = await db.account.findFirst({
					where: { userId: session.user.id, providerId: "credential" },
				});
				if (!credentialAccount?.password) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Password verification is not available for this account",
					});
				}

				const isValid = await verifyPassword({
					password: input.currentPassword,
					hash: credentialAccount.password,
				});
				if (!isValid) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is incorrect",
					});
				}

				// Check if email is already taken (by another user's primary or pending email)
				const existingEmail = await db.user.findFirst({
					where: {
						OR: [{ email: newEmail }, { pendingEmail: newEmail }],
						id: { not: session.user.id },
					},
				});
				if (existingEmail) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Email is already in use",
					});
				}
			}

			const canSendEmail = await isEmailDeliveryEnabled();

			// If email is changing and we can send verification emails, use the pending flow
			if (newEmail !== null && canSendEmail) {
				const token = crypto.randomBytes(32).toString("hex");
				const hashedToken = hashToken(token);
				const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours
				const appUrl =
					env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997";

				const updated = await db.user.update({
					where: { id: session.user.id },
					data: {
						name: input.name,
						username: input.username,
						pendingEmail: newEmail,
						pendingEmailToken: hashedToken,
						pendingEmailExpiresAt: expiresAt,
					},
					select: IDENTITY,
				});

				// Send verification email to the NEW address
				const confirmUrl = `${appUrl}/auth/confirm-email?token=${token}`;
				const verificationHtml = getEmailChangeVerificationTemplate(
					confirmUrl,
					newEmail,
				);
				sendEmail(
					newEmail,
					"Confirm Your New Email Address",
					verificationHtml,
				).catch((err) =>
					console.error("Failed to send email change verification:", err),
				);

				// Send security alert to the OLD address
				const revertUrl = `${appUrl}/auth/revert-email?token=${token}`;
				const alertHtml = getEmailChangeAlertTemplate(revertUrl, newEmail);
				sendEmail(
					session.user.email,
					"Security Alert: Email Change Requested",
					alertHtml,
				).catch((err) =>
					console.error("Failed to send email change alert:", err),
				);

				return { ...updated, emailChangePending: true };
			}

			// No email change, or email is disabled - update directly
			const updated = await db.user.update({
				where: { id: session.user.id },
				data: {
					name: input.name,
					username: input.username,
					...(newEmail !== null ? { email: newEmail } : {}),
				},
				select: IDENTITY,
			});

			// With email off, addresses are trusted like at signup: if the account
			// is verified, pick up guest sessions and ghosts for the new address,
			// same as a confirmed email change. Needs the global db (RLS bypass);
			// the helper re-checks emailVerified and never throws.
			if (isEmailChange) {
				await migrateGuestDataForVerifiedUser(globalDb, session.user.id);
			}

			return updated;
		}),

	getPendingEmail: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			where: { id: ctx.session.user.id },
			select: {
				pendingEmail: true,
				pendingEmailExpiresAt: true,
			},
		});
		return {
			pendingEmail: user?.pendingEmail ?? null,
			pendingEmailExpiresAt: user?.pendingEmailExpiresAt ?? null,
		};
	}),

	cancelPendingEmailChange: protectedProcedure.mutation(async ({ ctx }) => {
		await ctx.db.user.update({
			where: { id: ctx.session.user.id },
			data: {
				pendingEmail: null,
				pendingEmailToken: null,
				pendingEmailExpiresAt: null,
			},
		});
		return { success: true };
	}),

	changePassword: protectedProcedure
		.input(
			z
				.object({
					currentPassword: z.string().min(1, "Current password is required"),
					newPassword: z
						.string()
						.min(8, "Password must be at least 8 characters")
						.max(255)
						.regex(
							/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
							"Password must contain at least one uppercase letter, one lowercase letter, and one number",
						),
					confirmPassword: z.string().min(1, "Please confirm your password"),
				})
				.refine((data) => data.newPassword === data.confirmPassword, {
					error: "Passwords do not match",
					path: ["confirmPassword"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const credentialAccount = await db.account.findFirst({
				where: {
					userId: session.user.id,
					providerId: "credential",
				},
			});

			if (!credentialAccount?.password) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Password change is not available for this account",
				});
			}

			const isCurrentValid = await verifyPassword({
				password: input.currentPassword,
				hash: credentialAccount.password,
			});

			if (!isCurrentValid) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Current password is incorrect",
				});
			}

			const hashedPassword = await hashPassword(input.newPassword);

			await db.account.updateMany({
				where: {
					userId: session.user.id,
					providerId: "credential",
				},
				data: {
					password: hashedPassword,
				},
			});

			// Invalidate all other sessions to force re-login
			await db.session.deleteMany({
				where: {
					userId: session.user.id,
					id: { not: session.session.id },
				},
			});

			return { success: true };
		}),
	getLifetimeStats: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;
		const userId = session.user.id;

		const user = await db.user.findUnique({
			where: { id: userId },
			select: { createdAt: true, homeCurrency: true },
		});

		if (!user) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "User not found",
			});
		}

		const [totalEntries, { totalSpent: lifetimeSpend }] = await Promise.all([
			db.expense.count({
				where: { ...listedEntryWhere(userId), status: "FINALIZED" },
			}),
			new StatsService(db).getLifetimeStats(userId, user.homeCurrency),
		]);

		return {
			lifetimeSpend,
			totalEntries,
			joinedAt: user.createdAt,
			homeCurrency: user.homeCurrency,
		};
	}),
});

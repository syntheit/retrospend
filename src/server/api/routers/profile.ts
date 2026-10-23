import { TRPCError } from "@trpc/server";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { z } from "zod";
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
import { db } from "~/server/db";
import {
	cancelPendingEmailChange,
	getBackgroundSettings,
	saveBackgroundSettings,
	updateProfile,
} from "~/server/services/profile.service";
import { listedEntryWhere } from "~/server/services/spending";
import { StatsService } from "~/server/services/stats.service";
import { getImageUrl } from "~/server/storage";

export type { BackgroundSettings };
export { defaultBackgroundSettings };

export const profileRouter = createTRPCRouter({
	getBackgroundSettings: protectedProcedure.query(({ ctx }) =>
		getBackgroundSettings(ctx.db, ctx.session.user.id),
	),

	saveBackgroundSettings: protectedProcedure
		.input(backgroundSettingsSchema)
		.mutation(async ({ ctx, input }) => {
			await saveBackgroundSettings(ctx.db, ctx.session.user.id, input);
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
					.optional(),
				email: z.email("Invalid email address").max(254).optional(),
				currentPassword: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { emailChangePending, user } = await updateProfile(
				ctx.db,
				ctx.session.user,
				input,
			);
			return emailChangePending ? { ...user, emailChangePending: true } : user;
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
		await cancelPendingEmailChange(ctx.db, ctx.session.user.id);
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

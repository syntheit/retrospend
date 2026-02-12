import { TRPCError } from "@trpc/server";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import {
	getAppSettings,
	isInviteOnlyEnabled,
} from "~/server/services/settings";
import {
	deleteAnalyticsCategoryPreference,
	ensureAnalyticsCategoryPreferences,
	getAnalyticsCategoryPreferenceMap,
	getPageSettings,
	updateAnalyticsCategoryPreference,
	updatePageSettings,
} from "~/server/services/user-settings";

export const settingsRouter = createTRPCRouter({
	getPageSettings: protectedProcedure
		.input(
			z.object({
				page: z.enum([
					"DASHBOARD",
					"BUDGET",
					"ANALYTICS",
					"WEALTH",
					"EXCHANGE_RATES",
					"SETTINGS",
					"TABLE",
					"ACCOUNT",
					"INVITE_CODES",
					"ADMIN",
					"EXPENSE",
				]),
			}),
		)
		.query(async ({ input, ctx }) => {
			return await getPageSettings(ctx.session.user.id, input.page);
		}),

	updatePageSettings: protectedProcedure
		.input(
			z.object({
				page: z.enum([
					"DASHBOARD",
					"BUDGET",
					"ANALYTICS",
					"WEALTH",
					"EXCHANGE_RATES",
					"SETTINGS",
					"TABLE",
					"ACCOUNT",
					"INVITE_CODES",
					"ADMIN",
					"EXPENSE",
				]),
				settings: z.any(), // Will be validated by the service
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await updatePageSettings(
				ctx.session.user.id,
				input.page,
				input.settings,
			);
		}),

	getAnalyticsCategoryPreferences: protectedProcedure.query(async ({ ctx }) => {
		return await ensureAnalyticsCategoryPreferences(ctx.session.user.id);
	}),

	updateAnalyticsCategoryPreference: protectedProcedure
		.input(
			z.object({
				categoryId: z.string(),
				isFlexible: z.boolean(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await updateAnalyticsCategoryPreference(
				ctx.session.user.id,
				input.categoryId,
				input.isFlexible,
			);
		}),

	deleteAnalyticsCategoryPreference: protectedProcedure
		.input(
			z.object({
				categoryId: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await deleteAnalyticsCategoryPreference(
				ctx.session.user.id,
				input.categoryId,
			);
		}),

	getAnalyticsCategoryPreferenceMap: protectedProcedure.query(
		async ({ ctx }) => {
			return await getAnalyticsCategoryPreferenceMap(ctx.session.user.id);
		},
	),

	updateProfile: protectedProcedure
		.input(
			z
				.object({
					name: z.string().min(1, "Name is required"),
					username: z.string().min(1, "Username is required"),
					email: z.string().email("Invalid email address"),
					password: z
						.string()
						.min(8, "Password must be at least 8 characters")
						.optional(),
					currentPassword: z
						.string()
						.min(8, "Current password is required when changing password")
						.optional(),
				})
				.refine((data) => !data.password || !!data.currentPassword, {
					message: "Current password is required",
					path: ["currentPassword"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			if (input.username !== session.user.username) {
				const existingUsername = await db.user.findUnique({
					where: { username: input.username },
				});
				if (existingUsername) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Username is already taken",
					});
				}
			}

			if (input.email !== session.user.email) {
				const existingEmail = await db.user.findUnique({
					where: { email: input.email },
				});
				if (existingEmail) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Email is already in use",
					});
				}
			}

			const updatedUser = await db.user.update({
				where: { id: session.user.id },
				data: {
					name: input.name,
					username: input.username,
					email: input.email,
				},
				select: {
					id: true,
					name: true,
					username: true,
					email: true,
				},
			});

			if (input.password?.trim()) {
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
					password: input.currentPassword ?? "",
					hash: credentialAccount.password,
				});

				if (!isCurrentValid) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is incorrect",
					});
				}

				const hashedPassword = await hashPassword(input.password);

				await db.account.updateMany({
					where: {
						userId: session.user.id,
						providerId: "credential",
					},
					data: {
						password: hashedPassword,
					},
				});
			}

			return updatedUser;
		}),

	getGeneral: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const user = await db.user.findUnique({
			where: { id: session.user.id },
			select: {
				homeCurrency: true,
				defaultCurrency: true,
				categoryClickBehavior: true,
				fontPreference: true,
				currencySymbolStyle: true,
				monthlyIncome: true,
				budgetMode: true,
			},
		});

		if (!user) {
			throw new Error("User not found");
		}

		const appSettings = await getAppSettings();

		return {
			homeCurrency: user.homeCurrency,
			defaultCurrency: user.defaultCurrency,
			categoryClickBehavior: user.categoryClickBehavior,
			fontPreference: user.fontPreference,
			currencySymbolStyle: user.currencySymbolStyle,
			monthlyIncome: user.monthlyIncome,
			budgetMode: user.budgetMode,
			allowAllUsersToGenerateInvites:
				appSettings.allowAllUsersToGenerateInvites,
		};
	}),

	updateGeneral: protectedProcedure
		.input(
			z.object({
				homeCurrency: z.string().length(3, "Currency must be 3 characters"),
				defaultCurrency: z
					.string()
					.length(3, "Currency must be 3 characters")
					.optional(),
				categoryClickBehavior: z.enum(["navigate", "toggle"]).optional(),
				fontPreference: z.enum(["sans", "mono"]).optional(),
				currencySymbolStyle: z.enum(["native", "standard"]).optional(),
				budgetMode: z.enum(["GLOBAL_LIMIT", "SUM_OF_CATEGORIES"]).optional(),
				monthlyIncome: z
					.number()
					.min(0, "Monthly income must be non-negative")
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			return await db.user.update({
				where: { id: session.user.id },
				data: {
					homeCurrency: input.homeCurrency,
					...(input.categoryClickBehavior && {
						categoryClickBehavior: input.categoryClickBehavior,
					}),
					...(input.fontPreference && {
						fontPreference: input.fontPreference,
					}),
					...(input.currencySymbolStyle && {
						currencySymbolStyle: input.currencySymbolStyle,
					}),
					...(input.budgetMode && {
						budgetMode: input.budgetMode,
					}),
					...(input.defaultCurrency && {
						defaultCurrency: input.defaultCurrency,
					}),
					...(input.monthlyIncome !== undefined && {
						monthlyIncome: input.monthlyIncome,
					}),
				},
				select: {
					homeCurrency: true,
					defaultCurrency: true,
					categoryClickBehavior: true,
					currencySymbolStyle: true,
					budgetMode: true,
				},
			});
		}),

	getFavoriteCurrencies: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const favorites = await db.exchangeRateFavorite.findMany({
			where: {
				userId: session.user.id,
			},
			include: {
				exchangeRate: {
					select: {
						currency: true,
					},
				},
			},
			orderBy: {
				order: "asc",
			},
		});

		const seen = new Set<string>();
		const favoriteCurrencies: string[] = [];

		for (const favorite of favorites) {
			const currency = favorite.exchangeRate.currency;
			if (!seen.has(currency)) {
				seen.add(currency);
				favoriteCurrencies.push(currency);
			}
		}

		return favoriteCurrencies;
	}),

	getFavoriteExchangeRates: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const favorites = await db.exchangeRateFavorite.findMany({
			where: {
				userId: session.user.id,
			},
			include: {
				exchangeRate: true,
			},
			orderBy: {
				order: "asc",
			},
		});

		return favorites.map((f) => ({
			id: f.exchangeRateId,
			order: f.order,
			rate: f.exchangeRate,
		}));
	}),

	reorderFavorites: protectedProcedure
		.input(
			z.object({
				exchangeRateIds: z.array(z.string()),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;
			const { exchangeRateIds } = input;

			await db.$transaction(async (tx) => {
				const favorites = await tx.exchangeRateFavorite.findMany({
					where: { userId: session.user.id },
					select: { exchangeRateId: true },
				});

				const favoriteIds = new Set(favorites.map((f) => f.exchangeRateId));
				const validIdsToUpdate = exchangeRateIds.filter((id) =>
					favoriteIds.has(id),
				);

				await Promise.all(
					validIdsToUpdate.map((id, index) =>
						tx.exchangeRateFavorite.update({
							where: {
								userId_exchangeRateId: {
									userId: session.user.id,
									exchangeRateId: id,
								},
							},
							data: {
								order: -1 - index,
							},
						}),
					),
				);

				await Promise.all(
					validIdsToUpdate.map((id, index) =>
						tx.exchangeRateFavorite.update({
							where: {
								userId_exchangeRateId: {
									userId: session.user.id,
									exchangeRateId: id,
								},
							},
							data: {
								order: index,
							},
						}),
					),
				);
			});

			return { success: true };
		}),

	getFavoriteExchangeRateIds: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const favorites = await db.exchangeRateFavorite.findMany({
			where: {
				userId: session.user.id,
			},
			select: {
				exchangeRateId: true,
			},
		});

		return favorites.map((favorite) => favorite.exchangeRateId);
	}),

	toggleFavoriteExchangeRate: protectedProcedure
		.input(
			z.object({
				exchangeRateId: z.string().cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const rate = await db.exchangeRate.findUnique({
				where: { id: input.exchangeRateId },
			});

			if (!rate) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Exchange rate not found",
				});
			}

			const existingFavorite = await db.exchangeRateFavorite.findUnique({
				where: {
					userId_exchangeRateId: {
						userId: session.user.id,
						exchangeRateId: input.exchangeRateId,
					},
				},
			});

			if (existingFavorite) {
				await db.exchangeRateFavorite.delete({
					where: { id: existingFavorite.id },
				});
				return { isFavorite: false };
			}

			const maxOrder = await db.exchangeRateFavorite.findFirst({
				where: { userId: session.user.id },
				orderBy: { order: "desc" },
				select: { order: true },
			});

			const nextOrder = (maxOrder?.order ?? -1) + 1;

			await db.exchangeRateFavorite.create({
				data: {
					userId: session.user.id,
					exchangeRateId: input.exchangeRateId,
					order: nextOrder,
				},
			});

			return { isFavorite: true };
		}),
	getInviteOnlyEnabled: publicProcedure.query(async () => {
		const inviteOnlyEnabled = await isInviteOnlyEnabled();
		return {
			inviteOnlyEnabled,
		};
	}),
});

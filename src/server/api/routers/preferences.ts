import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

import {
	deleteAnalyticsCategoryPreference,
	ensureAnalyticsCategoryPreferences,
	getAnalyticsCategoryPreferenceMap,
	getPageSettings,
	updateAnalyticsCategoryPreference,
	updatePageSettings,
} from "~/server/services/user-settings";

export const preferencesRouter = createTRPCRouter({
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
				settings: z
					.object({
						version: z.literal(1).optional(),
						widgets: z
							.object({
								spendComposition: z.object({ visible: z.boolean() }).optional(),
								monthlyPacing: z.object({ visible: z.boolean() }).optional(),
								activityHeatmap: z.object({ visible: z.boolean() }).optional(),
								categoryTrends: z.object({ visible: z.boolean() }).optional(),
								recentExpenses: z.object({ visible: z.boolean() }).optional(),
								wealthAllocation: z.object({ visible: z.boolean() }).optional(),
							})
							.optional(),
						categoryPreferences: z
							.record(z.string(), z.object({ isFlexible: z.boolean() }))
							.optional(),
						showRolloverAmounts: z.boolean().optional(),
						showPegToActual: z.boolean().optional(),
						showCurrencyExposure: z.boolean().optional(),
						showHistoryChart: z.boolean().optional(),
						showFavoritesOnly: z.boolean().optional(),
						pageSize: z.number().min(10).max(100).optional(),
						showDescriptions: z.boolean().optional(),
						showUsedCodes: z.boolean().optional(),
						showInactiveUsers: z.boolean().optional(),
						defaultCurrency: z.string().length(3).optional(),
						showExchangeRates: z.boolean().optional(),
					})
					.strict(),
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
				exchangeRate: {
					include: {
						// Assuming we need BrandIcon if it's there, but original code just did include: { exchangeRate: true } which selects all.
						// Wait, verify original code in settings.ts:
						// include: { exchangeRate: true }
					},
				},
			},
			orderBy: {
				order: "asc",
			},
		});

		// Original used include: { exchangeRate: true }
		// But I see `exchangeRate: { select: { currency: true } }` in getFavoriteCurrencies.
		// For getFavoriteExchangeRates, I should just follow exactly what was there.
		// Wait, `favorites` from `findMany` with `include: { exchangeRate: true }` returns `ExchangeRateFavorite & { exchangeRate: ExchangeRate }`.
		// Let me double check if `BrandIcon` or relation needs to be included.
		// `src/server/api/routers/settings.ts` line 346: `include: { exchangeRate: true }`.
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
				exchangeRateId: z.string(),
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
});

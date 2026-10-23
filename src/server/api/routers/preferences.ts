import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

import {
	deleteAnalyticsCategoryPreference,
	ensureAnalyticsCategoryPreferences,
	getAnalyticsCategoryPreferenceMap,
	getPageSettings,
	setAnalyticsCategoryPreference,
	updatePageSettings,
} from "~/server/services/user-settings";
import {
	listFavoriteRates,
	reorderFavoriteRates,
	toggleFavoriteRate,
} from "~/server/services/rate-favorites.service";

export const preferencesRouter = createTRPCRouter({
	getPageSettings: protectedProcedure
		.input(
			z.object({
				page: z.enum([
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
					"PROFILE",
				]),
			}),
		)
		.query(async ({ input, ctx }) => {
			return await getPageSettings(ctx.db, ctx.session.user.id, input.page);
		}),

	updatePageSettings: protectedProcedure
		.input(
			z.object({
				page: z.enum([
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
					"PROFILE",
				]),
				settings: z.strictObject({
					version: z.number().optional(),
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
				}),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await updatePageSettings(
				ctx.db,
				ctx.session.user.id,
				input.page,
				input.settings as Parameters<typeof updatePageSettings>[3],
			);
		}),

	getAnalyticsCategoryPreferences: protectedProcedure.query(async ({ ctx }) => {
		return await ensureAnalyticsCategoryPreferences(
			ctx.db,
			ctx.session.user.id,
		);
	}),

	updateAnalyticsCategoryPreference: protectedProcedure
		.input(
			z.object({
				categoryId: z.cuid(),
				isFlexible: z.boolean(),
			}),
		)
		.mutation(async ({ input, ctx }) =>
			setAnalyticsCategoryPreference(
				ctx.db,
				ctx.session.user.id,
				input.categoryId,
				input.isFlexible,
			),
		),

	deleteAnalyticsCategoryPreference: protectedProcedure
		.input(
			z.object({
				categoryId: z.cuid(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await deleteAnalyticsCategoryPreference(
				ctx.db,
				ctx.session.user.id,
				input.categoryId,
			);
		}),

	getAnalyticsCategoryPreferenceMap: protectedProcedure.query(
		async ({ ctx }) => {
			return await getAnalyticsCategoryPreferenceMap(
				ctx.db,
				ctx.session.user.id,
			);
		},
	),

	getFavoriteCurrencies: protectedProcedure.query(async ({ ctx }) => {
		const favorites = await listFavoriteRates(ctx.db, ctx.session.user.id);
		return [...new Set(favorites.map((f) => f.exchangeRate.currency))];
	}),

	getFavoriteExchangeRates: protectedProcedure.query(async ({ ctx }) => {
		const favorites = await listFavoriteRates(ctx.db, ctx.session.user.id);
		return favorites.map((f) => ({
			id: f.exchangeRateId,
			order: f.order,
			rate: f.exchangeRate,
		}));
	}),

	reorderFavorites: protectedProcedure
		.input(
			z.object({
				exchangeRateIds: z.array(z.cuid()).max(100),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await reorderFavoriteRates(
				ctx.db,
				ctx.session.user.id,
				input.exchangeRateIds,
			);
			return { success: true };
		}),

	getFavoriteExchangeRateIds: protectedProcedure.query(async ({ ctx }) => {
		const favorites = await listFavoriteRates(ctx.db, ctx.session.user.id);
		return favorites.map((f) => f.exchangeRateId);
	}),

	toggleFavoriteExchangeRate: protectedProcedure
		.input(
			z.object({
				exchangeRateId: z.cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) =>
			toggleFavoriteRate(ctx.db, ctx.session.user.id, input.exchangeRateId),
		),
});

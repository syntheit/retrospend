import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import {
	getRateSyncStatus,
	requestRateSync,
} from "~/server/services/exchange-rate.service";

export const exchangeRateRouter = createTRPCRouter({
	getRate: publicProcedure
		.input(z.object({ currency: z.string().min(3).max(10) }))
		.query(async ({ ctx, input }) => {
			const rate = await ctx.db.exchangeRate.findFirst({
				where: { currency: input.currency.toUpperCase() },
				orderBy: [{ date: "desc" }, { type: "asc" }],
				select: { rate: true, type: true, currency: true },
			});
			return rate ?? null;
		}),

	getLastSync: protectedProcedure.query(
		async ({ ctx }) => (await getRateSyncStatus(ctx.db)).latestRateDate,
	),

	getRatesForCurrency: protectedProcedure
		.input(
			z.object({
				currency: z.string().min(3).max(10),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { db } = ctx;

			const rates = await db.exchangeRate.findMany({
				where: {
					currency: input.currency,
				},
				distinct: ["type"],
				orderBy: [{ date: "desc" }, { type: "asc" }],
				select: {
					type: true,
					rate: true,
					date: true,
				},
			});

			return rates;
		}),

	getAllRates: protectedProcedure
		.input(
			z
				.object({
					currency: z.string().min(3).max(10).optional(),
					type: z.string().min(1).max(32).optional(),
					limit: z.number().int().min(1).max(1000).default(1000),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const { db } = ctx;

			const rates = await db.exchangeRate.findMany({
				where: {
					currency: input?.currency,
					type: input?.type,
				},
				distinct: ["currency", "type"],
				take: input?.limit ?? 1000,
				orderBy: [{ currency: "asc" }, { type: "asc" }, { date: "desc" }],
				select: {
					id: true,
					date: true,
					currency: true,
					type: true,
					rate: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			return rates;
		}),

	syncNow: adminProcedure.mutation(async () => {
		try {
			await requestRateSync();
			return {
				success: true,
				message: "Successfully triggered exchange rate sync",
			};
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { syncExchangeRates } from "~/lib/exchange-rates";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";

export const exchangeRateRouter = createTRPCRouter({
	// Get the timestamp of the most recent exchange rate sync
	getLastSync: publicProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		const lastSync = await db.exchangeRate.findFirst({
			orderBy: {
				createdAt: "desc",
			},
			select: {
				createdAt: true,
			},
		});

		return lastSync?.createdAt || null;
	}),

	// Get available exchange rates for a specific currency
	getRatesForCurrency: publicProcedure
		.input(
			z.object({
				currency: z.string().length(3),
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

	// Get all exchange rates (optionally filtered and limited)
	getAllRates: publicProcedure
		.input(
			z
				.object({
					currency: z.string().length(3).optional(),
					type: z.string().min(1).max(32).optional(),
					limit: z.number().int().min(1).max(1000).default(500),
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
				take: input?.limit ?? 500,
				orderBy: [{ date: "desc" }, { currency: "asc" }, { type: "asc" }],
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

	// Manually trigger exchange rate sync
	syncNow: protectedProcedure.mutation(async ({ ctx }) => {
		const { db } = ctx;
		const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

		const lastSync = await db.exchangeRate.findFirst({
			orderBy: { createdAt: "desc" },
			select: { createdAt: true },
		});

		if (
			lastSync &&
			Date.now() - lastSync.createdAt.getTime() < MIN_SYNC_INTERVAL_MS
		) {
			throw new TRPCError({
				code: "TOO_MANY_REQUESTS",
				message: "Exchange rates were recently synced. Please try again later.",
			});
		}

		try {
			const syncedCount = await syncExchangeRates();
			return {
				success: true,
				syncedCount,
				message: `Successfully synced ${syncedCount} exchange rates`,
			};
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}),
});

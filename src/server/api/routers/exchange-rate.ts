import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { IntegrationService } from "~/server/services/integration.service";

export const exchangeRateRouter = createTRPCRouter({
	getLastSync: publicProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		const lastSync = await db.exchangeRate.findFirst({
			orderBy: {
				date: "desc",
			},
			select: {
				date: true,
			},
		});

		return lastSync?.date || null;
	}),

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

	syncNow: protectedProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;
		const MIN_SYNC_INTERVAL_MS = 1 * 60 * 1000; // Reduced to 1 minute for manual triggers

		const isAdmin = session.user.role === "ADMIN";

		if (!isAdmin) {
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
					message:
						"Exchange rates were recently synced. Please try again later.",
				});
			}
		}

		try {
			// Trigger sync on worker
			await IntegrationService.request(`${env.WORKER_URL}/sync-rates`, {
				method: "POST",
			});

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

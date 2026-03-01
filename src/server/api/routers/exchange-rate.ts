import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { IntegrationService } from "~/server/services/integration.service";

export const exchangeRateRouter = createTRPCRouter({
	getLastSync: protectedProcedure.query(async ({ ctx }) => {
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

	syncNow: protectedProcedure.mutation(async ({ ctx }) => {
		const { session } = ctx;

		const isAdmin = session.user.role === "ADMIN";

		if (!isAdmin) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only administrators can trigger exchange rate sync",
			});
		}

		try {
			// Trigger sync on worker
			await IntegrationService.requestWorker(`${env.WORKER_URL}/sync-rates`, {
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

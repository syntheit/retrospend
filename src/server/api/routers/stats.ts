import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { StatsService } from "~/server/services/stats.service";

export const statsRouter = createTRPCRouter({
	getSummary: protectedProcedure
		.input(
			z.object({
				month: z.date(),
				homeCurrency: z.string().length(3),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new StatsService(ctx.db);
			return await service.getSummaryStats(
				ctx.session.user.id,
				input.month,
				input.homeCurrency,
			);
		}),

	getCategoryBreakdown: protectedProcedure
		.input(
			z.object({
				month: z.date(),
				homeCurrency: z.string().length(3),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new StatsService(ctx.db);
			return await service.getCategoryBreakdown(
				ctx.session.user.id,
				input.month,
				input.homeCurrency,
			);
		}),

	getDailyTrend: protectedProcedure
		.input(
			z.object({
				month: z.date(),
				homeCurrency: z.string().length(3),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new StatsService(ctx.db);
			return await service.getDailyTrend(
				ctx.session.user.id,
				input.month,
				input.homeCurrency,
			);
		}),

	getLifetimeStats: protectedProcedure
		.input(
			z.object({
				userId: z.string().optional(),
				homeCurrency: z.string().length(3).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new StatsService(ctx.db);
			const userId = input.userId ?? ctx.session.user.id;

			// If homeCurrency not provided, we might need to fetch it or use a default
			// For now, let's try to get it from context if possible, but ctx.session only has basic info
			// Let's just use USD as default if not provided, or better, fetch it.
			let homeCurrency = input.homeCurrency;
			if (!homeCurrency) {
				const user = await ctx.db.user.findUnique({
					where: { id: userId },
					select: { homeCurrency: true },
				});
				homeCurrency = user?.homeCurrency ?? "USD";
			}

			return await service.getLifetimeStats(userId, homeCurrency);
		}),
});

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
});

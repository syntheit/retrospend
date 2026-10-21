import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getExcludedProjectIds } from "~/server/services/shared-expense-integration";
import { StatsService } from "~/server/services/stats.service";
import type { db as Db } from "~/server/db";

/** Stats service plus fiscal start day for the caller. */
async function statsFor(ctx: {
	db: typeof Db;
	session: { user: { id: string } };
	timeZone?: string;
}) {
	const userId = ctx.session.user.id;
	const [user, excludedProjectIds] = await Promise.all([
		ctx.db.user.findUnique({
			where: { id: userId },
			select: { fiscalMonthStartDay: true },
		}),
		getExcludedProjectIds(ctx.db, userId),
	]);
	return {
		service: new StatsService(
			ctx.db,
			undefined,
			excludedProjectIds,
			ctx.timeZone,
		),
		fiscalStartDay: user?.fiscalMonthStartDay ?? 1,
	};
}

export const statsRouter = createTRPCRouter({
	getSummary: protectedProcedure
		.input(
			z.object({
				month: z.date(),
				homeCurrency: z.string().length(3),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { service, fiscalStartDay } = await statsFor(ctx);
			return await service.getSummaryStats(
				ctx.session.user.id,
				input.month,
				input.homeCurrency,
				fiscalStartDay,
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
			const { service, fiscalStartDay } = await statsFor(ctx);
			return await service.getCategoryBreakdown(
				ctx.session.user.id,
				input.month,
				input.homeCurrency,
				fiscalStartDay,
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
			const { service, fiscalStartDay } = await statsFor(ctx);
			return await service.getDailyTrend(
				ctx.session.user.id,
				input.month,
				input.homeCurrency,
				fiscalStartDay,
			);
		}),

	getLifetimeStats: protectedProcedure
		.input(
			z.object({
				homeCurrency: z.string().length(3).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new StatsService(ctx.db);
			const userId = ctx.session.user.id;

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

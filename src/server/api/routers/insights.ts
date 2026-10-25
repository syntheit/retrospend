import {
	insightsCashflowInputSchema,
	insightsMonthsInputSchema,
	insightsSummaryInputSchema,
	insightsYtdInputSchema,
} from "~/lib/schemas/insights";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	insightsCashflow,
	insightsFirstDay,
	insightsMonths,
	insightsSummary,
	insightsYtd,
} from "~/server/services/insights";

/**
 * Activity > Insights (IMPLEMENTATION §5 2E.4). Thin: each read calls one
 * service. Every number is a registered `insights.*` figure.
 */
export const insightsRouter = createTRPCRouter({
	/** Spending over a range by category, with Compare to previous period. */
	summary: protectedProcedure
		.input(insightsSummaryInputSchema)
		.query(({ ctx, input }) =>
			insightsSummary(ctx.db, ctx.session.user.id, input, {
				timeZone: ctx.timeZone,
			}),
		),
	/** The day of the oldest spending: where All time starts. */
	firstDay: protectedProcedure.query(({ ctx }) =>
		insightsFirstDay(ctx.db, ctx.session.user.id, { timeZone: ctx.timeZone }),
	),
	/** The bars of Month by month. */
	months: protectedProcedure
		.input(insightsMonthsInputSchema)
		.query(({ ctx, input }) =>
			insightsMonths(ctx.db, ctx.session.user.id, input, {
				timeZone: ctx.timeZone,
			}),
		),
	/** Year to date against the same span last year, in home and USD. */
	ytd: protectedProcedure
		.input(insightsYtdInputSchema)
		.query(({ ctx, input }) =>
			insightsYtd(ctx.db, ctx.session.user.id, input, {
				timeZone: ctx.timeZone,
			}),
		),
	/** Income, saved, savings rate and the averages for a range. */
	cashflow: protectedProcedure
		.input(insightsCashflowInputSchema)
		.query(({ ctx, input }) =>
			insightsCashflow(ctx.db, ctx.session.user.id, input, {
				timeZone: ctx.timeZone,
			}),
		),
});

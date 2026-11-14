/**
 * Income against spending for a range: what came in, what was left, the
 * share of income saved and the averages. Spending is `spentItems` (the one
 * definition), income is the glance's money in (incomeItems), both totaled
 * in the home currency by the totals rule at the range's rate.
 *
 * - Daily average: spending over the days elapsed, so a range that runs
 *   past today is not diluted by days that have not happened yet.
 * - Monthly average: spending over the fiscal periods the range touches.
 */
import {
	fiscalPeriodsTouched,
	type Span,
	savingsRatePercent,
} from "@retrospend/domain/insights";
import {
	averageOf,
	type CashflowRead,
	cashflowOf,
	daysElapsed,
	savedOf,
} from "@retrospend/domain/insights-compute";
import type { Money } from "@retrospend/domain/money-minor";
import { dayKey } from "@retrospend/domain/time-zone";
import type { FigureDb } from "~/server/figures/registry";
import { incomeItems } from "~/server/services/figures/spend-pace";
import { spentItems } from "~/server/services/figures/spent";
import {
	type InsightsContext,
	insightsContext,
	instantRange,
	spentFilterFor,
} from "./context";
import { type CashflowDTO, INSIGHTS, type InsightsFigure } from "./types";

/** Spending and income of one range, unfiltered, in the home currency. */
export async function readCashflow(
	db: FigureDb,
	ctx: InsightsContext,
	range: Span,
): Promise<CashflowRead> {
	const when = instantRange(range, ctx.zone);
	return cashflowOf(
		await spentItems(db, spentFilterFor(ctx, range), "currency"),
		await incomeItems(db, ctx.userId, { start: when.gte, end: when.lte }),
		ctx,
		range,
	);
}

const figure = (id: string, value: Money | null): InsightsFigure => ({
	id,
	value,
});

export async function cashflowIn(
	db: FigureDb,
	userId: string,
	input: { readonly range: Span },
	options: { timeZone?: string; now?: Date } = {},
): Promise<CashflowDTO> {
	const ctx = await insightsContext(db, userId, options);
	const read = await readCashflow(db, ctx, input.range);
	const today = dayKey(ctx.now, ctx.zone);
	return {
		home: ctx.home,
		range: input.range,
		income: figure(INSIGHTS.income, read.income),
		saved: figure(INSIGHTS.saved, savedOf(read)),
		savingsRatePct:
			read.spent && read.income
				? savingsRatePercent(read.income.minor, read.spent.minor)
				: null,
		dailyAverage: figure(
			INSIGHTS.dailyAverage,
			averageOf(read.spent, daysElapsed(input.range, today)),
		),
		monthlyAverage: figure(
			INSIGHTS.monthlyAverage,
			averageOf(read.spent, fiscalPeriodsTouched(input.range, ctx.startDay)),
		),
		missingRates: read.missing,
	};
}

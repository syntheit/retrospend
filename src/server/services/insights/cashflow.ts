/**
 * Income against spending for a range: what came in, what was left, the
 * share of income saved and the averages. Spending is `spentItems` (the one
 * definition), income is the glance's money in (incomeItems), both totaled
 * in the home currency by the totals rule at the range's rate.
 *
 * - Daily average: spending over the days elapsed, so a range that runs
 *   past today is not diluted by days that have not happened yet.
 * - Monthly average: spending over the calendar months the range touches.
 */
import {
	averageMinor,
	daysBetween,
	monthsTouched,
	type Span,
	savingsRatePercent,
} from "@retrospend/domain/insights";
import type { Money } from "@retrospend/domain/money-minor";
import { dayKey } from "@retrospend/domain/time-zone";
import type { FigureDb } from "~/server/figures/registry";
import { incomeItems } from "~/server/services/figures/spend-pace";
import { spentItems } from "~/server/services/figures/spent";
import {
	type InsightsContext,
	insightsContext,
	instantRange,
	spanRate,
	spentFilterFor,
	valueIn,
} from "./context";
import { type CashflowDTO, INSIGHTS, type InsightsFigure } from "./types";

export interface CashflowRead {
	readonly spent: Money | null;
	readonly income: Money | null;
	readonly missing: readonly string[];
}

/** Spending and income of one range, unfiltered, in the home currency. */
export async function readCashflow(
	db: FigureDb,
	ctx: InsightsContext,
	range: Span,
): Promise<CashflowRead> {
	const rate = spanRate(ctx, range);
	const when = instantRange(range, ctx.zone);
	const spent = valueIn(
		await spentItems(db, spentFilterFor(ctx, range), "currency"),
		ctx.home,
		rate,
	);
	const income = valueIn(
		await incomeItems(db, ctx.userId, { start: when.gte, end: when.lte }),
		ctx.home,
		rate,
	);
	return {
		spent: spent.money,
		income: income.money,
		missing: [...new Set([...spent.missing, ...income.missing])].sort(),
	};
}

/** Spending split over `days` days (null for none), half to even. */
export function averageOf(spent: Money | null, divisor: number): Money | null {
	if (!spent || divisor <= 0) return null;
	return {
		minor: averageMinor(spent.minor, divisor),
		currency: spent.currency,
	};
}

/** Days of the range that have happened by `today`. */
export function daysElapsed(range: Span, today: string): number {
	const last = range.to < today ? range.to : today;
	return daysBetween(range.from, last) + 1;
}

export function savedOf(read: CashflowRead): Money | null {
	return read.spent && read.income
		? {
				minor: read.income.minor - read.spent.minor,
				currency: read.income.currency,
			}
		: null;
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
			averageOf(read.spent, monthsTouched(input.range)),
		),
		missingRates: read.missing,
	};
}

/**
 * The readings of the 14 `insights.*` figures, picked from the shared Insights
 * compute (insights-compute.ts): the default view (this fiscal period, no
 * filters) as the server registry and a device registry both read it, so
 * the two choose the same span, the same side and the same unavailable
 * marker. A loader supplies the rows; nothing here reads a store.
 *
 * - insights.spent, insights.spentPrevious: this period and the one before
 *   (previousPeriod), in the home currency.
 * - insights.byCategory [categoryId]: one category of it (0 when nothing).
 * - insights.byMonth [month]: one fiscal month ("2026-10"; this one when
 *   omitted).
 * - insights.income, insights.saved: money in this period, and money in
 *   minus spending (signed).
 * - insights.dailyAverage, insights.monthlyAverage: spending per elapsed
 *   day, and per fiscal period the period touches.
 * - insights.ytd, insights.ytdLastYear, insights.ytdByCategory
 *   [categoryId]: January 1 to today against the same span last year, in
 *   the home currency; the Usd twins total the same rows at their frozen
 *   USD values.
 *
 * Each is unavailable (null, currencies named) while a rate is missing.
 */
import { FigureUnavailable } from "./figures/unavailable";
import { getCurrentFiscalMonth, getFiscalMonthRange } from "./fiscal-month";
import { fiscalPeriodsTouched, type Span, yearToDate } from "./insights";
import {
	averageOf,
	type CashflowRead,
	daysElapsed,
	type InsightsContext,
	type MonthTotal,
	type SpanRead,
	savedOf,
	type YtdSide,
} from "./insights-compute";
import type { Money } from "./money-minor";
import { dayKey } from "./time-zone";

/** The default view's span: the fiscal period holding now. */
export function insightsPeriod(
	ctx: Pick<InsightsContext, "now" | "startDay" | "zone">,
): Span {
	const label = getCurrentFiscalMonth(ctx.now, ctx.startDay, ctx.zone);
	const range = getFiscalMonthRange(label, ctx.startDay, ctx.zone);
	return {
		from: dayKey(range.start, ctx.zone),
		to: dayKey(range.end, ctx.zone),
	};
}

/** A reading, or the unavailable marker naming the currencies that kept it out. */
export function reading(
	money: Money | null,
	missing: readonly string[],
): Money | FigureUnavailable {
	return money ?? new FigureUnavailable(missing);
}

/** insights.spent and insights.spentPrevious: a span's total. */
export function spanReading(read: SpanRead): Money | FigureUnavailable {
	return reading(read.total.money, read.total.missing);
}

/** insights.byCategory: one category of a span; a category with nothing reads 0 in home. */
export function categoryReading(
	read: SpanRead,
	categoryId: string,
	home: string,
): Money | FigureUnavailable {
	const value = read.categories.get(categoryId);
	return value
		? reading(value.money, value.missing)
		: { minor: 0, currency: home };
}

/** insights.byMonth: the one month a loader read. */
export function monthReading(
	bars: readonly MonthTotal[],
	missing: readonly string[],
): Money | FigureUnavailable {
	return reading(bars[0]?.total ?? null, missing);
}

/** What a cashflow figure picks from the period's read. */
export type CashflowPick = (
	read: CashflowRead,
	ctx: InsightsContext,
	period: Span,
) => Money | null;

export const cashflowPicks = {
	income: (read) => read.income,
	saved: (read) => savedOf(read),
	dailyAverage: (read, ctx, period) =>
		averageOf(read.spent, daysElapsed(period, dayKey(ctx.now, ctx.zone))),
	monthlyAverage: (read, ctx, period) =>
		averageOf(read.spent, fiscalPeriodsTouched(period, ctx.startDay)),
} satisfies Record<string, CashflowPick>;

/** insights.income, saved and the averages from the period's cashflow read. */
export function cashflowReading(
	pick: CashflowPick,
	read: CashflowRead,
	ctx: InsightsContext,
	period: Span,
): Money | FigureUnavailable {
	return reading(pick(read, ctx, period), read.missing);
}

/** This year to today and the same span last year, in the viewer's zone. */
export function insightsYtdSpans(ctx: Pick<InsightsContext, "now" | "zone">): {
	thisYear: Span;
	lastYear: Span;
} {
	return yearToDate(dayKey(ctx.now, ctx.zone));
}

/**
 * The ytd figures from one side's read: its total, or one category of it
 * (nothing there reads 0), in the home currency or in USD.
 */
export function ytdReading(
	side: YtdSide,
	currency: "home" | "usd",
	ctx: Pick<InsightsContext, "home">,
	categoryId?: string,
): Money | FigureUnavailable {
	const value =
		categoryId === undefined
			? side.total
			: (side.categories.get(categoryId) ?? null);
	if (categoryId !== undefined && !value)
		return { minor: 0, currency: currency === "usd" ? "USD" : ctx.home };
	return reading(value?.[currency] ?? null, side.missing);
}

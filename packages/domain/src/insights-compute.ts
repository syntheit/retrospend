/**
 * The pure half of Insights: what every read shares (the user's home
 * currency, fiscal start day and zone, one rate lookup and the clock) and the
 * two conversions every number goes through. The server loads its rows with
 * SQL and a device from its own store; both total them here, so a figure and
 * the page that shows it cannot differ, and a device prints the server's
 * digits.
 *
 * A figure is unavailable (null, with the currencies named) when a row cannot
 * be valued: a missing rate is never 1 (R14). Insights prices every total at
 * the home currency's best rate on one date (rateLookup over all its rows,
 * never a window), which is the server's pick as well.
 */
import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "./fiscal-month";
import { averageMinor, daysBetween, previousSpan, type Span } from "./insights";
import { periodRateDate, type RateRow, rateLookup, USD } from "./money";
import { type MoneyItemDec, missingRatesIn, sumInDec } from "./money-dec";
import { type Money, roundedMinor } from "./money-minor";
import type { SpentItem } from "./spent";
import { dayKey, parseDateOnlyIn, startOfNextDayIn } from "./time-zone";

/** The user's settings every Insights number reads. */
export interface InsightsSettings {
	readonly home: string;
	readonly zone: string;
	/** The fiscal month's first day (1 to 28). */
	readonly startDay: number;
}

export interface InsightsContext extends InsightsSettings {
	readonly now: Date;
	/** Units of home per 1 USD at `date`, or null when home has no rate at all. */
	readonly homeRateAt: (date: Date) => number | null;
}

/**
 * The context of one read: `rateRows` are all of the home currency's rate
 * rows (any dates and types). USD needs none and is always 1.
 */
export function insightsContextOf(
	args: InsightsSettings & {
		readonly now: Date;
		readonly rateRows: readonly RateRow[];
	},
): InsightsContext {
	const { home, zone, startDay, now } = args;
	const lookup = rateLookup({ [home]: args.rateRows });
	return {
		home,
		zone,
		startDay,
		now,
		homeRateAt: (date) => lookup(home, date)?.rate ?? null,
	};
}

/**
 * What Compare to previous period compares with. A span that is exactly one
 * of the user's fiscal periods meets the fiscal period before it, as Home's
 * last period does (with a start day of 15, Oct 15 to Nov 14 meets Sep 15 to
 * Oct 14). Any other span follows previousSpan.
 */
export function previousPeriod(
	ctx: Pick<InsightsContext, "zone" | "startDay">,
	span: Span,
): Span {
	const { zone, startDay } = ctx;
	const label = getCurrentFiscalMonth(
		parseDateOnlyIn(span.from, zone),
		startDay,
		zone,
	);
	const period = getFiscalMonthRange(label, startDay, zone);
	if (
		dayKey(period.start, zone) !== span.from ||
		dayKey(period.end, zone) !== span.to
	)
		return previousSpan(span);
	const before = getFiscalMonthRange(
		shiftMonth(label, -1, zone),
		startDay,
		zone,
	);
	return { from: dayKey(before.start, zone), to: dayKey(before.end, zone) };
}

/** The instants a span covers in the viewer's zone: its first midnight to its last millisecond. */
export function instantRange(span: Span, zone: string) {
	return {
		gte: parseDateOnlyIn(span.from, zone),
		lte: new Date(
			startOfNextDayIn(parseDateOnlyIn(span.to, zone), zone).getTime() - 1,
		),
	};
}

/** A total, or the currencies that kept it out. */
export type Valued =
	| { readonly money: Money; readonly missing: readonly [] }
	| { readonly money: null; readonly missing: readonly string[] };

/**
 * Items totaled in `currency` under the totals rule (frozen booked values
 * first, then each item's stored USD value at `rate`), rounded once to
 * minor units.
 */
export function valueIn(
	items: readonly MoneyItemDec[],
	currency: string,
	rate: number | null,
): Valued {
	const missing = missingRatesIn(items, currency, rate);
	if (missing.length) return { money: null, missing };
	return {
		money: {
			minor: roundedMinor(sumInDec(items, currency, rate), currency),
			currency,
		},
		missing: [],
	};
}

/** The rate that converts a span's totals: the one at its end, or now if sooner. */
export function spanRate(
	ctx: Pick<InsightsContext, "zone" | "now" | "homeRateAt">,
	span: Span,
): number | null {
	const end = instantRange(span, ctx.zone).lte;
	return ctx.homeRateAt(periodRateDate(end, ctx.now));
}

// Readers build on the items of the one spending definition (spent.ts), loaded
// by the server with SQL and by a device from its rows.

/** Items grouped by their category (null: none). */
export function groupByCategory(
	items: readonly SpentItem[],
): Map<string | null, SpentItem[]> {
	const groups = new Map<string | null, SpentItem[]>();
	for (const item of items) {
		const list = groups.get(item.categoryId) ?? [];
		list.push(item);
		groups.set(item.categoryId, list);
	}
	return groups;
}

export interface SpanRead {
	readonly total: Valued;
	/** Expenses behind the total. */
	readonly count: number;
	readonly categories: ReadonlyMap<string | null, Valued>;
}

/** One span's spending (items grouped by category), totaled and split by category in the home currency. */
export function spanReadOf(
	items: readonly SpentItem[],
	ctx: InsightsContext,
	span: Span,
): SpanRead {
	const rate = spanRate(ctx, span);
	return {
		total: valueIn(items, ctx.home, rate),
		count: items.reduce((n, item) => n + item.count, 0),
		categories: new Map(
			[...groupByCategory(items)].map(([id, group]) => [
				id,
				valueIn(group, ctx.home, rate),
			]),
		),
	};
}

/** One amount in the home currency and the same rows in USD at their frozen values. */
export interface HomeAndUsd {
	readonly home: Money | null;
	readonly usd: Money | null;
}

export interface YtdSide {
	readonly total: HomeAndUsd;
	readonly categories: ReadonlyMap<string | null, HomeAndUsd>;
	readonly missing: readonly string[];
}

/**
 * One year-to-date span in both currencies, split by category. The USD view
 * totals the same rows at their frozen values: each row's stored USD value,
 * or its own amount when it is in USD, never a rate looked up again.
 */
export function ytdSideOf(
	items: readonly SpentItem[],
	ctx: InsightsContext,
	span: Span,
): YtdSide {
	const rate = spanRate(ctx, span);
	const both = (group: readonly SpentItem[]) => {
		const home = valueIn(group, ctx.home, rate);
		const usd = valueIn(group, USD, 1);
		return { value: { home: home.money, usd: usd.money }, home, usd };
	};
	const all = both(items);
	return {
		total: all.value,
		categories: new Map(
			[...groupByCategory(items)].map(([id, group]) => [id, both(group).value]),
		),
		missing: [...new Set([...all.home.missing, ...all.usd.missing])].sort(),
	};
}

/** The month label ("2026-10") of the fiscal month holding `at`. */
export function fiscalMonthLabel(
	ctx: Pick<InsightsContext, "zone" | "startDay">,
	at: Date,
): string {
	return dayKey(
		getCurrentFiscalMonth(at, ctx.startDay, ctx.zone),
		ctx.zone,
	).slice(0, 7);
}

/** One fiscal month of a window: its label and its first and last instant. */
export interface MonthRange {
	readonly label: string;
	readonly start: Date;
	readonly end: Date;
}

/**
 * The fiscal months named by `labels` (oldest first) and the one span that
 * covers them all, which a loader reads once. Null for no labels.
 */
export function monthsWindow(
	ctx: Pick<InsightsContext, "zone" | "startDay">,
	labels: readonly string[],
): { readonly ranges: readonly MonthRange[]; readonly span: Span } | null {
	const ranges = labels.map((label): MonthRange => {
		const range = getFiscalMonthRange(
			parseDateOnlyIn(`${label}-01`, ctx.zone),
			ctx.startDay,
			ctx.zone,
		);
		return { label, start: range.start, end: range.end };
	});
	const first = ranges[0];
	const last = ranges.at(-1);
	if (!first || !last) return null;
	return {
		ranges,
		span: {
			from: dayKey(first.start, ctx.zone),
			to: dayKey(last.end, ctx.zone),
		},
	};
}

export interface MonthTotal {
	/** The fiscal month's label, "2026-10". */
	readonly month: string;
	/** The month's first and last day. */
	readonly span: Span;
	readonly total: Money | null;
}

/**
 * Each month's total from items grouped per entry instant ("day"): a row
 * falls into its month by its instant, and each month converts at the rate
 * at its own end (or now, if sooner).
 */
export function monthBarsOf(
	items: readonly SpentItem[],
	ctx: InsightsContext,
	ranges: readonly MonthRange[],
): { bars: MonthTotal[]; missing: string[] } {
	const missing = new Set<string>();
	const bars = ranges.map((range): MonthTotal => {
		const inMonth = items.filter(
			(item) =>
				item.date !== null &&
				item.date.getTime() >= range.start.getTime() &&
				item.date.getTime() <= range.end.getTime(),
		);
		const value = valueIn(
			inMonth,
			ctx.home,
			ctx.homeRateAt(periodRateDate(range.end, ctx.now)),
		);
		for (const currency of value.missing) missing.add(currency);
		return {
			month: range.label,
			span: {
				from: dayKey(range.start, ctx.zone),
				to: dayKey(range.end, ctx.zone),
			},
			total: value.money,
		};
	});
	return { bars, missing: [...missing].sort() };
}

export interface CashflowRead {
	readonly spent: Money | null;
	readonly income: Money | null;
	readonly missing: readonly string[];
}

/** Spending and income of one range in the home currency, at the range's rate. */
export function cashflowOf(
	spentItems: readonly SpentItem[],
	incomeItems: readonly MoneyItemDec[],
	ctx: InsightsContext,
	range: Span,
): CashflowRead {
	const rate = spanRate(ctx, range);
	const spent = valueIn(spentItems, ctx.home, rate);
	const income = valueIn(incomeItems, ctx.home, rate);
	return {
		spent: spent.money,
		income: income.money,
		missing: [...new Set([...spent.missing, ...income.missing])].sort(),
	};
}

/** Spending split over `divisor` days or periods (null for none), half to even. */
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

/** Income minus spending, signed; null while either is unavailable. */
export function savedOf(read: CashflowRead): Money | null {
	return read.spent && read.income
		? {
				minor: read.income.minor - read.spent.minor,
				currency: read.income.currency,
			}
		: null;
}

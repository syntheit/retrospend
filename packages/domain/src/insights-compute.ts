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
import { previousSpan, type Span } from "./insights";
import { periodRateDate, type RateRow, rateLookup } from "./money";
import { type MoneyItemDec, missingRatesIn, sumInDec } from "./money-dec";
import { type Money, roundedMinor } from "./money-minor";
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

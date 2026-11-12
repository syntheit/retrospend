/**
 * Pure pieces of Home's spending glance (kit `pace()` and `cumulative()`):
 * spending per day of a period in the home currency under the totals rule
 * (@retrospend/domain/money-dec sumInDec), the running total day by day in minor units, and
 * whether this period runs faster than the last by the same day.
 *
 * Sums are exact Decimals until each running total is turned into minor
 * units once (half to even), the way the Activity footer rounds its total, so
 * the last point of a full period equals the period's total.
 */
import {
	type MoneyItemDec,
	missingRatesIn,
	type RateInput,
	sumInDec,
} from "./money-dec";
import { roundedMinor } from "./money-minor";
import { Dec, type Decimal } from "./precise-decimal";

export type IsoDate = string;

export interface PeriodSpan {
	readonly from: IsoDate;
	readonly to: IsoDate;
	/** Calendar days in the period. */
	readonly days: number;
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
	const utc = (d: IsoDate) => {
		const [y, m, day] = d.split("-").map(Number) as [number, number, number];
		return Date.UTC(y, m - 1, day);
	};
	return Math.round((utc(b) - utc(a)) / 86_400_000);
}

export function spanOf(from: IsoDate, to: IsoDate): PeriodSpan {
	return { from, to, days: daysBetween(from, to) + 1 };
}

export interface DatedItem {
	/** The calendar day of the row in the viewer's zone. */
	readonly day: IsoDate;
	readonly item: MoneyItemDec;
}

const inSpan = (rows: readonly DatedItem[], span: PeriodSpan) =>
	rows.filter(({ day }) => day >= span.from && day <= span.to);

/**
 * Every currency that keeps `span` from totaling in `home`: the home rate
 * when a foreign row needs it, and unpriced shares in another currency.
 */
export function missingIn(
	rows: readonly DatedItem[],
	span: PeriodSpan,
	home: string,
	rate: RateInput,
): string[] {
	return missingRatesIn(
		inSpan(rows, span).map((r) => r.item),
		home,
		rate,
	);
}

/**
 * The running total at the end of each day of `span` (index 0 = day 1) in
 * `home`, exact and unrounded; rows outside the span are ignored. Each point
 * is one sumInDec over every row up to that day, not a sum of per-day
 * conversions: a share converts from its amount and rate in one division per
 * currency and rate, so the last point is exactly the period total and an
 * exact tie stays a tie however the rows fall across days. Null when
 * missingIn names anything: a missing rate is never 1 (R14).
 */
export function runningHome(
	rows: readonly DatedItem[],
	span: PeriodSpan,
	home: string,
	rate: RateInput,
): Decimal[] | null {
	if (missingIn(rows, span, home, rate).length) return null;
	const days = Array.from({ length: span.days }, (): MoneyItemDec[] => []);
	for (const { day, item } of inSpan(rows, span))
		days[daysBetween(span.from, day)]?.push(item);
	const upToToday: MoneyItemDec[] = [];
	return days.map((items) => {
		for (const item of items) upToToday.push(item);
		return upToToday.length ? sumInDec(upToToday, home, rate) : new Dec(0);
	});
}

/** The running totals of days 1..upTo, each rounded once to minor units. */
export function cumulativeMinor(
	running: readonly Decimal[],
	upTo: number,
	currency: string,
): number[] {
	return running.slice(0, upTo).map((total) => roundedMinor(total, currency));
}

/**
 * The kit's pace word: faster when this period is more than 3% ahead of
 * the last by the same day. Null with nothing spent last period, where a
 * comparison would say nothing. Integer math on minor units.
 */
export function fasterThanLast(now: number, then: number): boolean | null {
	if (then <= 0) return null;
	return BigInt(now) * 100n > BigInt(then) * 103n;
}

/**
 * Pure pieces of Home's spending glance (kit `pace()` and `cumulative()`):
 * spending per day of a period in the home currency under the totals rule
 * (~/lib/money sumIn), the running total day by day in minor units, and
 * whether this period runs faster than the last by the same day.
 *
 * Sums stay unrounded until each running total is turned into minor units
 * once (half to even), the way the Activity footer rounds its total, so the
 * last point of a full period equals the period's total exactly.
 */
import {
	amountIn,
	isValidRate,
	type MoneyItem,
	USD,
} from "@retrospend/domain/money";
import { toMinor } from "@retrospend/domain/money-minor";

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
	readonly item: MoneyItem;
}

/**
 * Spending per day of `span` (index 0 = day 1) in `home`, unrounded; rows
 * outside the span are ignored. Null when a row needs the home rate and
 * there is none: a missing rate is never 1 (R14).
 */
export function dailyHome(
	rows: readonly DatedItem[],
	span: PeriodSpan,
	home: string,
	rate: number | null,
): number[] | null {
	const rateless = home !== USD && !isValidRate(rate);
	const daily = new Array<number>(span.days).fill(0);
	for (const { day, item } of rows) {
		if (day < span.from || day > span.to) continue;
		const own = item.currency === home || item.booked?.currency === home;
		if (rateless && !own) return null;
		const i = daysBetween(span.from, day);
		daily[i] = (daily[i] ?? 0) + amountIn(item, home, rate);
	}
	return daily;
}

/** Running totals for days 1..upTo, each rounded once to minor units. */
export function cumulativeMinor(
	daily: readonly number[],
	upTo: number,
	currency: string,
): number[] {
	const out: number[] = [];
	let total = 0;
	for (let i = 0; i < Math.min(upTo, daily.length); i++) {
		total += daily[i] ?? 0;
		out.push(toMinor(total, currency));
	}
	return out;
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

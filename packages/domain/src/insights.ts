/**
 * Pure pieces of Insights: the day spans it compares, and the few ratios it
 * shows (change, savings rate, averages). Days are YYYY-MM-DD keys in the
 * viewer's calendar, so none of this depends on a zone; the services turn
 * them into instants. Ratios are whole percents or minor units, rounded
 * half to even on exact integer math, so no float decides a digit.
 */

/** YYYY-MM-DD in the viewer's calendar. */
export type DayKey = string;

/** First and last day, both inclusive. */
export interface Span {
	readonly from: DayKey;
	readonly to: DayKey;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function parts(day: DayKey): { y: number; m: number; d: number } {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!match) throw new Error(`Not a day key: ${day}`);
	return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const key = (y: number, m: number, d: number) =>
	`${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

const utcDay = (day: DayKey) => {
	const { y, m, d } = parts(day);
	return Date.UTC(y, m - 1, d);
};

function fromUtc(ms: number): DayKey {
	const date = new Date(ms);
	return key(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(day: DayKey, days: number): DayKey {
	return fromUtc(utcDay(day) + days * 86_400_000);
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: DayKey, b: DayKey): number {
	return Math.round((utcDay(b) - utcDay(a)) / 86_400_000);
}

/** Days in a span, both ends counted. */
export function daysIn(span: Span): number {
	return daysBetween(span.from, span.to) + 1;
}

const daysInMonth = (y: number, m: number) =>
	new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The last day of the month `day` is in. */
export function lastDayOfMonth(day: DayKey): DayKey {
	const { y, m } = parts(day);
	return key(y, m, daysInMonth(y, m));
}

/** The first day of the month `months` away from the one `day` is in. */
export function shiftMonthStart(day: DayKey, months: number): DayKey {
	const { y, m } = parts(day);
	const index = y * 12 + (m - 1) + months;
	return key(Math.floor(index / 12), (index % 12) + 1, 1);
}

/** Whole calendar months a span touches (October 24 to November 2 touches 2). */
export function monthsTouched(span: Span): number {
	const a = parts(span.from);
	const b = parts(span.to);
	return (b.y - a.y) * 12 + (b.m - a.m) + 1;
}

/**
 * The period before, for Compare to previous period: a whole calendar month
 * compares with the whole month before it (March with February, whatever
 * their lengths); any other span compares with the same number of days
 * right before it.
 */
export function previousSpan(span: Span): Span {
	if (parts(span.from).d === 1 && span.to === lastDayOfMonth(span.from)) {
		const from = shiftMonthStart(span.from, -1);
		return { from, to: lastDayOfMonth(from) };
	}
	const days = daysIn(span);
	return { from: addDays(span.from, -days), to: addDays(span.from, -1) };
}

/** The same calendar day one year earlier; February 29 becomes February 28. */
export function yearBefore(day: DayKey): DayKey {
	const { y, m, d } = parts(day);
	return key(y - 1, m, Math.min(d, daysInMonth(y - 1, m)));
}

/**
 * Year to date and the same span last year: January 1 to `today`, against
 * January 1 of last year to the same calendar day.
 */
export function yearToDate(today: DayKey): { thisYear: Span; lastYear: Span } {
	const { y } = parts(today);
	return {
		thisYear: { from: key(y, 1, 1), to: today },
		lastYear: { from: key(y - 1, 1, 1), to: yearBefore(today) },
	};
}

/** a / b rounded half to even, for exact integers (b > 0). */
function divideHalfEven(a: bigint, b: bigint): bigint {
	const negative = a < 0n;
	const magnitude = negative ? -a : a;
	let quotient = magnitude / b;
	const twice = (magnitude - quotient * b) * 2n;
	if (twice > b || (twice === b && quotient % 2n === 1n)) quotient += 1n;
	return negative ? -quotient : quotient;
}

/** Minor units split `divisor` ways, half to even (an average). */
export function averageMinor(total: number, divisor: number): number {
	if (!Number.isInteger(total) || !Number.isInteger(divisor) || divisor <= 0)
		throw new RangeError(
			"averageMinor takes whole minor units and a positive divisor",
		);
	// `|| 0` turns a rounded -0 into 0.
	return Number(divideHalfEven(BigInt(total), BigInt(divisor))) || 0;
}

/**
 * Change from `previous` to `current` in whole percent, signed, half to even.
 * Null when there is nothing to compare with: a previous of zero or less
 * reads "new", never a percent of nothing.
 */
export function percentChange(
	current: number,
	previous: number,
): number | null {
	if (!Number.isInteger(current) || !Number.isInteger(previous))
		throw new RangeError("percentChange takes whole minor units");
	if (previous <= 0) return null;
	const diff = BigInt(current) - BigInt(previous);
	return Number(divideHalfEven(diff * 100n, BigInt(previous))) || 0;
}

/**
 * Share of income left after spending, in whole percent, half to even.
 * Negative when more went out than came in; null without income.
 */
export function savingsRatePercent(
	income: number,
	spent: number,
): number | null {
	if (!Number.isInteger(income) || !Number.isInteger(spent))
		throw new RangeError("savingsRatePercent takes whole minor units");
	if (income <= 0) return null;
	const saved = BigInt(income) - BigInt(spent);
	return Number(divideHalfEven(saved * 100n, BigInt(income))) || 0;
}

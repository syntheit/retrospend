/**
 * Calendar math in a given IANA time zone.
 *
 * Expense dates are instants. Which day or month an instant belongs to depends
 * on the user's time zone: 22:30 on Oct 31 in Buenos Aires is already Nov 1 in
 * UTC. The browser sends its zone with every request (x-timezone header and a
 * "tz" cookie, see src/server/time-zone.ts in the web app) and the server
 * buckets in that zone.
 *
 * Every helper takes an optional `timeZone`. Without one it uses the runtime's
 * local zone, which is what client code wants.
 */

export interface WallTime {
	year: number;
	/** 0-based, like Date#getMonth. */
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		});
		formatters.set(timeZone, formatter);
	}
	return formatter;
}

/** A valid IANA zone name, or undefined. */
export function normalizeTimeZone(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0 || value.length > 64) {
		return undefined;
	}
	try {
		formatterFor(value);
		return value;
	} catch {
		return undefined;
	}
}

/** The local date and time of `date` in `timeZone`. */
export function wallTime(date: Date, timeZone?: string): WallTime {
	if (!timeZone) {
		return {
			year: date.getFullYear(),
			month: date.getMonth(),
			day: date.getDate(),
			hour: date.getHours(),
			minute: date.getMinutes(),
			second: date.getSeconds(),
			millisecond: date.getMilliseconds(),
		};
	}
	const parts = formatterFor(timeZone).formatToParts(date);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value);
	return {
		year: get("year"),
		month: get("month") - 1,
		day: get("day"),
		hour: get("hour") % 24,
		minute: get("minute"),
		second: get("second"),
		millisecond: date.getUTCMilliseconds(),
	};
}

function offsetAt(instant: number, timeZone: string): number {
	const w = wallTime(new Date(instant), timeZone);
	return (
		Date.UTC(w.year, w.month, w.day, w.hour, w.minute, w.second, w.millisecond) -
		instant
	);
}

/**
 * The instant at which the clock in `timeZone` reads the given local time.
 * Out-of-range parts roll over like the Date constructor (month 12 is
 * January of the next year, day 0 is the last day of the previous month).
 */
export function fromWallTime(
	parts: {
		year: number;
		month: number;
		day?: number;
		hour?: number;
		minute?: number;
		second?: number;
		millisecond?: number;
	},
	timeZone?: string,
): Date {
	const {
		year,
		month,
		day = 1,
		hour = 0,
		minute = 0,
		second = 0,
		millisecond = 0,
	} = parts;
	if (!timeZone) {
		return new Date(year, month, day, hour, minute, second, millisecond);
	}
	const guess = Date.UTC(year, month, day, hour, minute, second, millisecond);
	const firstOffset = offsetAt(guess, timeZone);
	let instant = guess - firstOffset;
	// Around a DST change the offset at the result can differ from the guess.
	const secondOffset = offsetAt(instant, timeZone);
	if (secondOffset !== firstOffset) instant = guess - secondOffset;
	return new Date(instant);
}

/** "yyyy-MM-dd" as midnight of that day in `timeZone`. */
export function parseDateOnlyIn(value: string, timeZone?: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) throw new Error("Date must be in YYYY-MM-DD format");
	return fromWallTime(
		{
			year: Number(match[1]),
			month: Number(match[2]) - 1,
			day: Number(match[3]),
		},
		timeZone,
	);
}

/** Midnight at the start of `date`'s day in `timeZone`. */
export function startOfDayIn(date: Date, timeZone?: string): Date {
	const { year, month, day } = wallTime(date, timeZone);
	return fromWallTime({ year, month, day }, timeZone);
}

/** Midnight at the start of the day after `date`'s day in `timeZone`. */
export function startOfNextDayIn(date: Date, timeZone?: string): Date {
	const { year, month, day } = wallTime(date, timeZone);
	return fromWallTime({ year, month, day: day + 1 }, timeZone);
}

/** "yyyy-MM-dd" of `date` in `timeZone`. */
export function dayKey(date: Date, timeZone?: string): string {
	const { year, month, day } = wallTime(date, timeZone);
	return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whole calendar days from `from` to `to` (both read in `timeZone`). */
export function calendarDaysBetween(
	from: Date,
	to: Date,
	timeZone?: string,
): number {
	const a = wallTime(from, timeZone);
	const b = wallTime(to, timeZone);
	return Math.round(
		(Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) /
			86_400_000,
	);
}

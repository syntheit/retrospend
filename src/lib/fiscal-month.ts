/**
 * Fiscal month utilities.
 *
 * A "fiscal month" starts on the user-configured day (e.g. 15th) and ends the
 * day before the same day in the next calendar month.  The budget `period`
 * record is always keyed to the 1st of the calendar month that contains the
 * start of the fiscal period.
 *
 * Example with startDay = 15:
 *   Fiscal "March" = March 15 → April 14
 *   Budget period  = March 1
 *
 * A month label is any Date inside the month; only its year and month in the
 * user's time zone matter. Every helper takes an optional IANA `timeZone`
 * (see ~/lib/time-zone); the server passes the request's zone, the client
 * leaves it out and gets its local zone.
 */
import {
	calendarDaysBetween,
	fromWallTime,
	wallTime,
} from "./time-zone";

/**
 * Get the fiscal month date range for a given month label.
 * @param month  Any date within the calendar month (only year+month matter)
 * @param startDay  Day of the month the fiscal period begins (1–28)
 */
export function getFiscalMonthRange(
	month: Date,
	startDay: number,
	timeZone?: string,
): { start: Date; end: Date } {
	const { year, month: m } = wallTime(month, timeZone);
	const start = fromWallTime({ year, month: m, day: startDay }, timeZone);
	const nextStart = fromWallTime(
		{ year, month: m + 1, day: startDay },
		timeZone,
	);
	return { start, end: new Date(nextStart.getTime() - 1) };
}

/** The calendar month containing `month`: the 1st 00:00 to the last day 23:59:59.999. */
export function getCalendarMonthRange(
	month: Date,
	timeZone?: string,
): { start: Date; end: Date } {
	return getFiscalMonthRange(month, 1, timeZone);
}

/**
 * Month label `months` away from `month` (midnight on the 1st). Steps by
 * calendar month, so Jan 31 minus one month is December, never "Dec 31 + 1".
 */
export function shiftMonth(
	month: Date,
	months: number,
	timeZone?: string,
): Date {
	const { year, month: m } = wallTime(month, timeZone);
	return fromWallTime({ year, month: m + months }, timeZone);
}

/**
 * Budget.period key for the month containing `month`. Keys are midnight on
 * the 1st in the server's own zone (UTC in production), whatever the user's
 * zone; only the year and month are read in `timeZone`.
 */
export function budgetPeriod(month: Date, timeZone?: string): Date {
	const { year, month: m } = wallTime(month, timeZone);
	return new Date(year, m, 1);
}

/** Range of Budget.period keys that belong to the month containing `month`. */
export function budgetPeriodRange(
	month: Date,
	timeZone?: string,
): { gte: Date; lt: Date } {
	const { year, month: m } = wallTime(month, timeZone);
	return { gte: new Date(year, m, 1), lt: new Date(year, m + 1, 1) };
}

/**
 * Get which fiscal month a date falls in (returns 1st-of-month Date label).
 * @param date  The date to classify
 * @param startDay  Day of the month the fiscal period begins (1–28)
 */
export function getCurrentFiscalMonth(
	date: Date,
	startDay: number,
	timeZone?: string,
): Date {
	const { year, month, day } = wallTime(date, timeZone);
	// A day before startDay belongs to the previous calendar month's period.
	const offset = startDay > 1 && day < startDay ? -1 : 0;
	return fromWallTime({ year, month: month + offset }, timeZone);
}

/**
 * Calculate days remaining and progress in the fiscal period.
 */
export function getFiscalMonthProgress(
	now: Date,
	month: Date,
	startDay: number,
	timeZone?: string,
): {
	daysInPeriod: number;
	currentDay: number;
	daysRemaining: number;
	isCurrentPeriod: boolean;
} {
	const { start, end } = getFiscalMonthRange(month, startDay, timeZone);

	// Counted in calendar days, so a DST change inside the period does not
	// add or drop a day.
	const daysInPeriod = calendarDaysBetween(start, end, timeZone) + 1;

	const isCurrentPeriod = now >= start && now <= end;

	if (!isCurrentPeriod) {
		return {
			daysInPeriod,
			currentDay: daysInPeriod,
			daysRemaining: 0,
			isCurrentPeriod,
		};
	}

	const currentDay = calendarDaysBetween(start, now, timeZone) + 1;
	const daysRemaining = Math.max(0, daysInPeriod - currentDay + 1);

	return { daysInPeriod, currentDay, daysRemaining, isCurrentPeriod };
}

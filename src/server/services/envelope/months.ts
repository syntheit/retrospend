/**
 * Budget months (SPEC §5.1, D21, C20, C21). A budget month is keyed by the
 * calendar month its start day falls in and runs to the day before the next
 * month's start. Start days come from BookPeriod rows, each in force from
 * its `fromMonth` on, so a change moves only future boundaries; the month
 * that straddles a change is longer or shorter.
 *
 * Dates are calendar dates (YYYY-MM-DD). An expense belongs to the month
 * containing the date the user picked; the book zone only decides "today".
 */
import { wallTime } from "@retrospend/domain/time-zone";
import { addDays, addMonths, calendarMonthOf, monthParts } from "./calendar";
import type { IsoDate, MonthKey } from "./types";

export interface MonthBoundary {
	fromMonth: MonthKey;
	startDay: number;
}

/** The start day in force for `month`: the latest period starting on or before it, else 1. */
export function startDayFor(
	month: MonthKey,
	periods: readonly MonthBoundary[],
): number {
	let found: MonthBoundary | null = null;
	for (const p of periods) {
		if (p.fromMonth <= month && (!found || p.fromMonth > found.fromMonth))
			found = p;
	}
	return found?.startDay ?? 1;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** First day of budget month `month`. */
export function monthStart(
	month: MonthKey,
	periods: readonly MonthBoundary[],
): IsoDate {
	const { year, month: m } = monthParts(month);
	return `${year}-${pad(m)}-${pad(startDayFor(month, periods))}`;
}

export interface MonthRange {
	from: IsoDate;
	to: IsoDate;
}

/** First and last day of budget month `month`, both included. */
export function monthRange(
	month: MonthKey,
	periods: readonly MonthBoundary[],
): MonthRange {
	return {
		from: monthStart(month, periods),
		to: addDays(monthStart(addMonths(month, 1), periods), -1),
	};
}

/** The budget month containing calendar date `date`. Start days are 1 to 28, so it is the date's calendar month or the one before. */
export function budgetMonthOf(
	date: IsoDate,
	periods: readonly MonthBoundary[],
): MonthKey {
	const cal = calendarMonthOf(date);
	return date >= monthStart(cal, periods) ? cal : addMonths(cal, -1);
}

/** The calendar date of an instant in `timeZone` (the date the user saw when they picked it). */
export function isoDateIn(instant: Date, timeZone: string): IsoDate {
	const w = wallTime(instant, timeZone);
	return `${w.year}-${pad(w.month + 1)}-${pad(w.day)}`;
}

/** Months from `from` to `to`, both included, oldest first. */
export function monthsFrom(from: MonthKey, to: MonthKey): MonthKey[] {
	const out: MonthKey[] = [];
	for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
	return out;
}

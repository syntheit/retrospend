import { differenceInCalendarDays, getDay, isSameDay } from "date-fns";
import { fromWallTime, type WallTime, wallTime } from "./time-zone";

export const FREQUENCY_LABELS: Record<string, string> = {
	WEEKLY: "Weekly",
	BIWEEKLY: "Biweekly",
	MONTHLY: "Monthly",
	QUARTERLY: "Quarterly",
	YEARLY: "Yearly",
};

export type RecurringFrequency =
	| "WEEKLY"
	| "BIWEEKLY"
	| "MONTHLY"
	| "QUARTERLY"
	| "YEARLY";

/**
 * Adds months to a date, landing on `anchorDay` (default: the date's own day)
 * or the last day of the target month when that month is shorter. Jan 31 + 1
 * is Feb 28 (or 29), and Feb 28 + 1 with anchor 31 is back to Mar 31.
 */
export function addMonthsClamped(
	date: Date,
	months: number,
	anchorDay?: number | null,
): Date {
	const result = new Date(date);
	const day = anchorDay ?? date.getDate();
	result.setDate(1);
	result.setMonth(result.getMonth() + months);
	const lastDay = new Date(
		result.getFullYear(),
		result.getMonth() + 1,
		0,
	).getDate();
	result.setDate(Math.min(day, lastDay));
	return result;
}

/**
 * Next due date of a recurring template, read and stepped as calendar days in
 * `timeZone`: a due date is stored as the start of the user's day, so the
 * process's own zone must never decide which day it is. The time of day is
 * kept, so a due date at local midnight stays at local midnight across a DST
 * change. Month-based frequencies keep the template's anchor day instead of
 * drifting after a short month; without one, the date's own day in the zone.
 * Pass "UTC" for days stored as UTC midnight (recurring income).
 */
export function nextRecurringDate(
	current: Date,
	frequency: RecurringFrequency,
	anchorDay: number | null | undefined,
	timeZone: string,
): Date {
	const wall = wallTime(current, timeZone);
	const at = (month: number, day: number) =>
		fromWallTime({ ...wall, month, day }, timeZone);
	switch (frequency) {
		case "WEEKLY":
			return at(wall.month, wall.day + 7);
		case "BIWEEKLY":
			return at(wall.month, wall.day + 14);
		case "MONTHLY":
			return atClampedDay(wall, 1, anchorDay, timeZone);
		case "QUARTERLY":
			return atClampedDay(wall, 3, anchorDay, timeZone);
		case "YEARLY":
			return atClampedDay(wall, 12, anchorDay, timeZone);
	}
}

/** `wall` moved `months` on, landing on `anchorDay` or the month's last day. */
function atClampedDay(
	wall: WallTime,
	months: number,
	anchorDay: number | null | undefined,
	timeZone: string,
): Date {
	const day = anchorDay ?? wall.day;
	const lastDay = new Date(
		Date.UTC(wall.year, wall.month + months + 1, 0),
	).getUTCDate();
	return fromWallTime(
		{ ...wall, month: wall.month + months, day: Math.min(day, lastDay) },
		timeZone,
	);
}

/**
 * Check if a recurring template is projected to occur on a given date
 * based on its frequency and nextDueDate.
 */
export function isProjectedOnDate(
	frequency: string,
	nextDueDate: Date,
	date: Date,
): boolean {
	const dueDate = new Date(nextDueDate);

	if (isSameDay(dueDate, date)) return true;

	switch (frequency) {
		case "MONTHLY":
			return dueDate.getDate() === date.getDate();
		case "WEEKLY":
			return getDay(dueDate) === getDay(date);
		case "BIWEEKLY": {
			const dayDiff = Math.abs(differenceInCalendarDays(date, dueDate));
			return dayDiff % 14 === 0;
		}
		case "QUARTERLY":
			return (
				dueDate.getDate() === date.getDate() &&
				Math.abs(date.getMonth() - dueDate.getMonth()) % 3 === 0
			);
		case "YEARLY":
			return (
				dueDate.getDate() === date.getDate() &&
				dueDate.getMonth() === date.getMonth()
			);
		default:
			return false;
	}
}

/**
 * Convert a frequency-specific amount to its monthly equivalent.
 */
export function toMonthlyEquivalent(amount: number, frequency: string): number {
	switch (frequency) {
		case "WEEKLY":
			return amount * (52 / 12);
		case "BIWEEKLY":
			return amount * (26 / 12);
		case "QUARTERLY":
			return amount / 3;
		case "YEARLY":
			return amount / 12;
		default:
			return amount;
	}
}

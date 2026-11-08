import { differenceInCalendarDays, getDay, isSameDay } from "date-fns";
import { dayKey, startOfWallDayIn, type WallTime, wallTime } from "./time-zone";

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
 * process's own zone must never decide which day it is. The result is always
 * the first instant of that day (local midnight, or 01:00 where DST skips
 * midnight), so no time-of-day drift persists across steps. Month-based frequencies keep the template's anchor day instead of
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
	const onDay = (month: number, day: number) =>
		startOfWallDayIn({ year: wall.year, month, day }, timeZone);
	switch (frequency) {
		case "WEEKLY":
			return onDay(wall.month, wall.day + 7);
		case "BIWEEKLY":
			return onDay(wall.month, wall.day + 14);
		case "MONTHLY":
			return onMonthsLater(wall, 1, anchorDay, timeZone);
		case "QUARTERLY":
			return onMonthsLater(wall, 3, anchorDay, timeZone);
		case "YEARLY":
			return onMonthsLater(wall, 12, anchorDay, timeZone);
	}
}

/** The start of the day `months` on from `wall`, on `anchorDay` or the month's last day. */
function onMonthsLater(
	wall: WallTime,
	months: number,
	anchorDay: number | null | undefined,
	timeZone: string,
): Date {
	const day = anchorDay ?? wall.day;
	const lastDay = new Date(
		Date.UTC(wall.year, wall.month + months + 1, 0),
	).getUTCDate();
	return startOfWallDayIn(
		{
			year: wall.year,
			month: wall.month + months,
			day: Math.min(day, lastDay),
		},
		timeZone,
	);
}

/**
 * The next due day after `day` (a calendar day stored as UTC midnight),
 * stepped as UTC days: income keeps its day as UTC midnight whatever zone the
 * user is in.
 */
export function nextDueDay(
	day: Date,
	frequency: RecurringFrequency,
	anchorDay?: number | null,
): Date {
	return nextRecurringDate(
		day,
		frequency,
		anchorDay ?? day.getUTCDate(),
		"UTC",
	);
}

/** What a due date is stepped from: the template's direction, frequency and anchor. */
export interface DueSchedule {
	readonly direction: "OUT" | "IN";
	readonly frequency: RecurringFrequency;
	readonly anchorDay: number | null;
}

/**
 * The due date after `from` for a template of either direction: income steps
 * UTC days, an expense steps days in the user's `timeZone`.
 */
export function nextDueAfter(
	schedule: DueSchedule,
	from: Date,
	timeZone: string,
): Date {
	return schedule.direction === "IN"
		? nextDueDay(from, schedule.frequency, schedule.anchorDay)
		: nextRecurringDate(from, schedule.frequency, schedule.anchorDay, timeZone);
}

/** The day of month a template is anchored to, read as its due day is stored. */
export function dueAnchorDay(
	schedule: DueSchedule & { readonly nextDueDate: Date },
	timeZone: string,
): number {
	if (schedule.anchorDay !== null) return schedule.anchorDay;
	return schedule.direction === "IN"
		? schedule.nextDueDate.getUTCDate()
		: wallTime(schedule.nextDueDate, timeZone).day;
}

/** The schedule a confirm is for: what its previous due day is worked out from. */
export interface PaidOnSchedule {
	readonly nextDueDate: Date;
	readonly frequency: RecurringFrequency;
	readonly anchorDay: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The day before this one in the template's schedule, as YYYY-MM-DD. Income
 * keeps its day as UTC midnight and an expense the start of the day in the
 * caller's zone, so the due date is read as that calendar day first.
 */
export function previousDueDay(
	schedule: PaidOnSchedule,
	direction: "OUT" | "IN",
	timeZone?: string,
): string {
	const [y, m, d] = dayKey(
		schedule.nextDueDate,
		direction === "IN" ? "UTC" : timeZone,
	)
		.split("-")
		.map(Number) as [number, number, number];
	const due = new Date(y, m - 1, d);
	const anchor = schedule.anchorDay ?? d;
	let prev: Date;
	switch (schedule.frequency) {
		case "WEEKLY":
			prev = new Date(y, m - 1, d - 7);
			break;
		case "BIWEEKLY":
			prev = new Date(y, m - 1, d - 14);
			break;
		case "MONTHLY":
			prev = addMonthsClamped(due, -1, anchor);
			break;
		case "QUARTERLY":
			prev = addMonthsClamped(due, -3, anchor);
			break;
		case "YEARLY":
			prev = addMonthsClamped(due, -12, anchor);
			break;
	}
	return `${String(prev.getFullYear()).padStart(4, "0")}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
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

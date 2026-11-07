import { nextRecurringDate } from "@retrospend/domain/recurring";
import { wallTime } from "@retrospend/domain/time-zone";
import type { RecurringFrequency } from "~prisma";

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

interface DueSchedule {
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

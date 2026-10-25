import { nextRecurringDate } from "@retrospend/domain/recurring";
import type { RecurringFrequency } from "~prisma";

/**
 * The next due day after `day` (a calendar day stored as UTC midnight).
 * nextRecurringDate steps local calendar fields, so a UTC midnight read in a
 * zone behind UTC would land a day early or late; this steps the day itself.
 */
export function nextDueDay(
	day: Date,
	frequency: RecurringFrequency,
	anchorDay?: number | null,
): Date {
	const local = new Date(
		day.getUTCFullYear(),
		day.getUTCMonth(),
		day.getUTCDate(),
	);
	const next = nextRecurringDate(
		local,
		frequency,
		anchorDay ?? day.getUTCDate(),
	);
	return new Date(
		Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()),
	);
}

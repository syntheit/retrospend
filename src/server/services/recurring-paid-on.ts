import { addMonthsClamped } from "@retrospend/domain/recurring";
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";

/** The schedule a confirm is for: what its previous due day is worked out from. */
export interface PaidOnSchedule {
	readonly nextDueDate: Date;
	readonly frequency:
		| "WEEKLY"
		| "BIWEEKLY"
		| "MONTHLY"
		| "QUARTERLY"
		| "YEARLY";
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
 * The instant a confirm books on when the user says it was paid (or received)
 * on another day. Recurring income keeps its day as UTC midnight and an
 * expense the start of the day in the caller's zone, the same conventions as
 * the template's own due date. A day still to come is refused: a confirm
 * records what happened. So is a day before the template's previous due day:
 * that belongs to the period before this one.
 */
export function paidOnInstant(
	day: string,
	direction: "OUT" | "IN",
	timeZone: string | undefined,
	schedule: PaidOnSchedule,
): Date {
	if (day > dayKey(new Date(), timeZone))
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The date cannot be in the future",
		});
	if (day < previousDueDay(schedule, direction, timeZone))
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The date is before the previous due date",
		});
	return direction === "IN"
		? new Date(`${day}T00:00:00.000Z`)
		: parseDateOnlyIn(day, timeZone);
}

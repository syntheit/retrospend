import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";

/**
 * The instant a confirm books on when the user says it was paid (or received)
 * on another day. Recurring income keeps its day as UTC midnight and an
 * expense the start of the day in the caller's zone, the same conventions as
 * the template's own due date. A day still to come is refused: a confirm
 * records what happened.
 */
export function paidOnInstant(
	day: string,
	direction: "OUT" | "IN",
	timeZone?: string,
): Date {
	if (day > dayKey(new Date(), timeZone))
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The date cannot be in the future",
		});
	return direction === "IN"
		? new Date(`${day}T00:00:00.000Z`)
		: parseDateOnlyIn(day, timeZone);
}

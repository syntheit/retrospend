import { TRPCError } from "@trpc/server";
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { dayKey } from "~/lib/time-zone";

/**
 * The calendar day a money move is dated, as a UTC midnight: the day the
 * client sent, else today in the user's zone. Never a future day: a leg
 * moves today's balance, so it must have happened already.
 */
export function moveDay(
	day: string | null | undefined,
	now: Date,
	timeZone?: string,
): Date {
	const today = dayKey(now, timeZone);
	const picked = day ?? today;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(picked) || Number.isNaN(Date.parse(picked))) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a valid date" });
	}
	if (picked > today) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A money move cannot be dated in the future",
		});
	}
	return new Date(`${picked}T00:00:00.000Z`);
}

/**
 * The date to store on an expense row (an income, a transfer's fee) for a
 * move dated `day` (a moveDay UTC midnight). The ledger keys legs,
 * transfers and checkpoints by that UTC-midnight day, but Activity and the
 * envelope budget read expense rows in the viewer's zone, as rows from the
 * expense form are stored: at the zone's own midnight. Without this, west of
 * UTC an income shows a day early and the 1st falls in the previous month.
 */
export function rowDateOf(day: Date, timeZone?: string): Date {
	return parseDateOnlyIn(day.toISOString().slice(0, 10), timeZone);
}

/** The calendar day of an expense row stored by rowDateOf, as moveDay takes it. */
export function rowDayOf(date: Date, timeZone?: string): string {
	return dayKey(date, timeZone);
}

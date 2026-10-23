import { TRPCError } from "@trpc/server";
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

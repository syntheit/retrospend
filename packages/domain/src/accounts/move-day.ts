import { dayKey } from "../time-zone";
import { AccountRefusal, MOVE_IN_FUTURE, PICK_VALID_DATE } from "./refusals";
import { snapshotDay } from "./snapshot-plan";

/**
 * The calendar day a money move is dated, as a UTC midnight: the day the
 * client sent, else today in the user's zone. Never a future day: a leg
 * moves today's balance, so it must have happened already. The server's
 * moveDay (services/accounts/dates.ts) and the device read this one.
 */
export function moveDay(
	day: string | null | undefined,
	now: Date,
	timeZone?: string,
): Date {
	// No day given: the person's today, which is snapshotDay's zone rule (the
	// one owner, so a snapshot and a same-day check never disagree).
	if (day == null) return snapshotDay({ rule: "zone", now, timeZone });
	const today = dayKey(now, timeZone);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)))
		throw new AccountRefusal("badRequest", PICK_VALID_DATE);
	if (day > today) throw new AccountRefusal("badRequest", MOVE_IN_FUTURE);
	return new Date(`${day}T00:00:00.000Z`);
}

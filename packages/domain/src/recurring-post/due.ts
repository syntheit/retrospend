/**
 * Whether a recurring period is due. `now` and the zone are arguments, never
 * read here, so the server and a device ask the same question of the same
 * clock. The rule is an argument too: the two readings below are what the
 * server answers today, and they differ for a due day stored as UTC midnight
 * (recurring income) in a zone west of UTC.
 */
import { dayOf } from "../accounts/series";
import { dayKey, startOfNextDayIn } from "../time-zone";

/**
 * - `start_of_next_day`: due while the due instant is before the start of the
 *   day after today in the zone (an expense's due instant is the start of its
 *   day in the saved zone). Confirm uses this for either direction.
 * - `utc_day`: due while the due date's UTC calendar day is on or before today
 *   in the zone (income's due day is a UTC midnight). Income confirm and
 *   income skip use this.
 */
export type DueRule = "start_of_next_day" | "utc_day";

export function isDue(
	nextDueDate: Date,
	now: Date,
	timeZone: string,
	rule: DueRule,
): boolean {
	return rule === "utc_day"
		? dayOf(nextDueDate) <= dayKey(now, timeZone)
		: nextDueDate < startOfNextDayIn(now, timeZone);
}

/**
 * The instant a confirm books on when the person says it was paid (or
 * received) on another day. `now` and the zone are arguments, never read here,
 * so the server and a device refuse the same days.
 *
 * Recurring income keeps its day as UTC midnight and an expense the start of
 * the day in the caller's zone, the same conventions as the template's own due
 * date. A day still to come is refused: a confirm records what happened. So is
 * a day before the template's previous due day: that belongs to the period
 * before this one.
 */
import { type PaidOnSchedule, previousDueDay } from "../recurring";
import { dayKey, parseDateOnlyIn } from "../time-zone";
import {
	DATE_BEFORE_PREVIOUS_DUE,
	DATE_IN_FUTURE,
	RecurringInputRefusal,
} from "./refusals";

export function paidOnInstant(
	day: string,
	direction: "OUT" | "IN",
	timeZone: string,
	schedule: PaidOnSchedule,
	now: Date,
): Date {
	if (day > dayKey(now, timeZone))
		throw new RecurringInputRefusal("date_in_future", DATE_IN_FUTURE);
	if (day < previousDueDay(schedule, direction, timeZone))
		throw new RecurringInputRefusal(
			"date_before_previous_due",
			DATE_BEFORE_PREVIOUS_DUE,
		);
	return direction === "IN"
		? new Date(`${day}T00:00:00.000Z`)
		: parseDateOnlyIn(day, timeZone);
}

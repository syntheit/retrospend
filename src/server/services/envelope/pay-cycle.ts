/**
 * The pay cycle asked at setup: how often you are paid and a pay date the
 * cycle counts from. Pure calendar math on YYYY-MM-DD strings (no time zone
 * enters: the caller passes today in the book's zone).
 */
import {
	addDays,
	addMonthsToDate,
	calendarMonthOf,
	daysBetween,
	monthsBetween,
} from "./calendar";
import type { IsoDate } from "./types";

export type PayFrequency = "MONTHLY" | "EVERY_TWO_WEEKS" | "WEEKLY" | "VARIES";

const STEP_DAYS = { EVERY_TWO_WEEKS: 14, WEEKLY: 7 } as const;

/**
 * The first pay on or after `today`, counting from `anchor`. A monthly cycle
 * keeps the anchor's day and uses a short month's last day (the 31st is the
 * 28th in February). Null when pay varies or there is no anchor.
 */
export function nextPay(
	frequency: PayFrequency | null,
	anchor: IsoDate | null,
	today: IsoDate,
): IsoDate | null {
	if (!frequency || frequency === "VARIES" || !anchor) return null;
	if (anchor >= today) return anchor;
	if (frequency === "MONTHLY") {
		const gone = monthsBetween(calendarMonthOf(anchor), calendarMonthOf(today));
		const here = addMonthsToDate(anchor, gone);
		return here >= today ? here : addMonthsToDate(anchor, gone + 1);
	}
	const step = STEP_DAYS[frequency];
	return addDays(anchor, Math.ceil(daysBetween(anchor, today) / step) * step);
}

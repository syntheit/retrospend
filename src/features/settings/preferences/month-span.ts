import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
} from "@retrospend/domain/fiscal-month";
import { formatDateOnly } from "~/lib/date";

/**
 * The first and last day of the budget month `today` falls in, for a month
 * that starts on `startDay` (the hint under "Month starts on day"). Uses the
 * one fiscal month definition the budget uses, in the viewer's zone.
 */
export function monthSpan(
	today: Date,
	startDay: number,
): { start: string; end: string } {
	const month = getCurrentFiscalMonth(today, startDay);
	const { start, end } = getFiscalMonthRange(month, startDay);
	return { start: formatDateOnly(start), end: formatDateOnly(end) };
}

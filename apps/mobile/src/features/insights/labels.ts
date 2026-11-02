import { lastDayOfMonth, type Span } from "@retrospend/domain/insights";

/**
 * A span in words, as the web's range chip says it: "Oct 2026" for a whole
 * month, "2026" for a whole year, else "Sep 22 to Oct 21" (with the year
 * when it is not this one). The words and the date formats come in from the
 * screen, so this stays free of the locale.
 */
export interface RangeWords {
	/** "Oct 2026". */
	month: (day: string) => string;
	/** "Sep 22". */
	day: (day: string) => string;
	/** "Sep 22, 2025". */
	dayWithYear: (day: string) => string;
	/** "Sep 22 to Oct 21". */
	span: (from: string, to: string) => string;
}

export function rangeLabel(
	span: Span,
	today: string,
	words: RangeWords,
): string {
	const { from, to } = span;
	if (from.endsWith("-01") && to === lastDayOfMonth(from))
		return words.month(from);
	const year = from.slice(0, 4);
	if (from === `${year}-01-01` && to === `${year}-12-31`) return year;
	const thisYear = today.slice(0, 4);
	const day = (d: string) =>
		d.slice(0, 4) === thisYear ? words.day(d) : words.dayWithYear(d);
	if (from === to) return day(from);
	return words.span(day(from), day(to));
}

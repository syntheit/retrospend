/**
 * What a book's valuations depend on, as one canonical string: its currency,
 * the zone its days are read in, the day it started and every period (the
 * month it takes effect, its start day and its rate type). A device holds
 * rows and frozen values valued under one key; when the book it pulls later
 * carries another, those values are stale and the budget figures are
 * unavailable until it pulls again. Compared by equality, never parsed.
 */
import type { BookRowCore } from "./book-source";

export type ValuationBook = Pick<
	BookRowCore,
	"currency" | "timeZone" | "startDate" | "periods"
>;

export function bookValuationKey(book: ValuationBook): string {
	// Periods in effect order: the order rows come back in is not part of the book.
	const periods = [...book.periods]
		.sort((a, b) => a.fromMonth - b.fromMonth)
		.map((p) => [p.fromMonth, p.startDay, p.rateType]);
	return JSON.stringify([
		book.currency,
		book.timeZone,
		book.startDate.toISOString(),
		periods,
	]);
}

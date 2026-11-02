// Month keys are YYYYMM numbers (the contract's own). Stepping and bounds are
// calendar arithmetic on the key, never on money.
import { addMonths, monthParts } from "@retrospend/domain/month-key";

export { addMonths, monthParts };

/** A date inside the month, for the locale's month name (UTC, so no zone shifts it). */
export function monthDate(key: number): Date {
	const { year, month } = monthParts(key);
	return new Date(Date.UTC(year, month - 1, 15));
}

export interface MonthBounds {
	/** The first month the book has. */
	first: number;
	/** The open month: the one the server calls current. */
	open: number;
}

/** The newest month that can be planned: the one after the open month. */
export function lastMonth(bounds: MonthBounds): number {
	return addMonths(bounds.open, 1);
}

/** Newest first, from the month after the open one back to the book's first (at most `limit`). */
export function monthChoices(bounds: MonthBounds, limit = 13): number[] {
	const out: number[] = [];
	for (
		let key = lastMonth(bounds);
		key >= bounds.first && out.length < limit;
		key = addMonths(key, -1)
	) {
		out.push(key);
	}
	return out;
}

export type MonthKind = "closed" | "open" | "next";

export function monthKind(key: number, bounds: MonthBounds): MonthKind {
	if (key < bounds.open) return "closed";
	return key === bounds.open ? "open" : "next";
}

/**
 * Where the month on screen sits. The server says whether it is closed, open
 * or next; the open month itself is known when the screen has seen it (it
 * always loads the current month first), else it is the month after a closed
 * one.
 */
export function monthInfo(
	month: { key: number; state: "CLOSED" | "OPEN" | "NEXT" },
	first: number,
	seenOpen: number | null,
): { kind: MonthKind; bounds: MonthBounds } {
	const open =
		month.state === "OPEN"
			? month.key
			: month.state === "NEXT"
				? addMonths(month.key, -1)
				: (seenOpen ?? addMonths(month.key, 1));
	return {
		kind:
			month.state === "OPEN"
				? "open"
				: month.state === "NEXT"
					? "next"
					: "closed",
		bounds: { first, open },
	};
}

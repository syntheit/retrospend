import { type RateDirection, rateDirection } from "@retrospend/domain/rate-format";

/**
 * The way a custom rate is typed for a pair: the number beside "1 USD =" is
 * the >= 1 one. The direction is fixed by the pair, not by what is typed: the
 * table's first rate for the pair decides, a saved entry's booked rate backs
 * it where the table has none. Neither changes while the person types (the
 * typed rate is never a reference), so the label and the stored rate never
 * flip between the click and the typing.
 */
export function customDirection(p: {
	currency: string;
	home: string;
	/** A table rate for the pair, home per one unit of `currency`. */
	table: string | null | undefined;
	/** The rate a saved entry was booked at, as stored. */
	savedRate: string | null;
}): RateDirection {
	return rateDirection(p.currency, p.home, p.table ?? p.savedRate);
}

/**
 * The Postgres side of the rate book: one query for the stored rates a book
 * needs. The book itself (lookups, nearest-rate rule) is pure and lives in
 * @retrospend/domain/envelope/rate-book; selectRateRows is its JS twin of
 * this SQL and rate-book.pg.test.ts holds the two to the same rows.
 */
import {
	RateBook,
	type RateBookParams,
	type RateRow,
	rateBookCurrencies,
} from "@retrospend/domain/envelope/rate-book";
import type { Prisma } from "~prisma";

type Tx = Prisma.TransactionClient;

/** Every rate from `since` on, plus the latest before it per currency and type, oldest first. */
export async function loadRateRows(
	tx: Tx,
	p: RateBookParams,
): Promise<RateRow[]> {
	const currencies = rateBookCurrencies(p);
	if (currencies.length === 0) return [];
	const since = new Date(`${p.since}T00:00:00Z`);
	// Anchors sort first (older dates).
	const rows = await tx.$queryRaw<
		Array<{ currency: string; type: string; rate: string; date: Date }>
	>`
		SELECT currency, type,
		       trim(trailing '.' from trim(trailing '0' from rate::text)) AS rate, date FROM (
			(SELECT DISTINCT ON (currency, type) currency, type, rate, date
			   FROM exchange_rate
			  WHERE currency = ANY(${currencies}) AND date < ${since}
			  ORDER BY currency, type, date DESC)
			UNION ALL
			(SELECT currency, type, rate, date
			   FROM exchange_rate
			  WHERE currency = ANY(${currencies}) AND date >= ${since})
		) r
		ORDER BY date ASC`;
	return rows.map((r) => ({
		currency: r.currency,
		type: r.type,
		rate: r.rate.toString(),
		date: r.date.toISOString().slice(0, 10),
	}));
}

export async function loadRateBook(
	tx: Tx,
	p: RateBookParams,
): Promise<RateBook> {
	return RateBook.fromRows(await loadRateRows(tx, p), p);
}

/**
 * Server-side exchange rate lookups. The selection rules live in
 * `pickBestRate` (~/lib/money); this module only fetches the rows.
 *
 * Every lookup falls back to the nearest available rate: the latest one on or
 * before the date, otherwise the earliest one after it. Only a currency with
 * no rate rows at all yields null (or a BAD_REQUEST from requireExchangeRate).
 */
import { TRPCError } from "@trpc/server";
import { type PickedRate, pickBestRate, USD } from "~/lib/money";
import type { Prisma, PrismaClient } from "~prisma";

type RateDb = Pick<PrismaClient | Prisma.TransactionClient, "exchangeRate">;

// Enough rows to cover every rate type of the newest one or two dates.
const ROWS_PER_SIDE = 20;

const USD_RATE = (date: Date): PickedRate => ({
	rate: 1,
	type: "official",
	date,
	onOrBefore: true,
});

async function fetchRows(db: RateDb, currency: string, date: Date) {
	const select = { type: true, rate: true, date: true } as const;
	let rows = await db.exchangeRate.findMany({
		where: { currency, date: { lte: date } },
		orderBy: [{ date: "desc" }, { type: "asc" }],
		take: ROWS_PER_SIDE,
		select,
	});
	if (rows.length === 0) {
		rows = await db.exchangeRate.findMany({
			where: { currency, date: { gt: date } },
			orderBy: [{ date: "asc" }, { type: "asc" }],
			take: ROWS_PER_SIDE,
			select,
		});
	}
	return rows.map((r) => ({
		type: r.type,
		rate: Number(r.rate),
		date: r.date,
	}));
}

/**
 * Best rate for `currency` on `date`. `preferredType` (e.g. "blue" or an
 * expense's pricingSource) wins when that type exists.
 */
export async function findExchangeRate(
	db: RateDb,
	currency: string,
	date: Date,
	preferredType?: string | null,
): Promise<PickedRate | null> {
	if (currency === USD) return USD_RATE(date);
	const rows = await fetchRows(db, currency, date);
	return pickBestRate(rows, { date, preferredType });
}

/** Like findExchangeRate, but a currency with no rates is a BAD_REQUEST. */
export async function requireExchangeRate(
	db: RateDb,
	currency: string,
	date: Date,
	preferredType?: string | null,
): Promise<PickedRate> {
	const rate = await findExchangeRate(db, currency, date, preferredType);
	if (!rate) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Exchange rate not found for ${currency}.`,
		});
	}
	return rate;
}

/**
 * Batch lookup for many (currency, date) pairs: one query per currency, then
 * the per-date pick happens in memory. Returns a resolver; it yields null only
 * for currencies without any rate.
 */
export async function findExchangeRatesForDates(
	db: RateDb,
	currencies: Iterable<string>,
): Promise<
	(currency: string, date: Date, preferredType?: string | null) => PickedRate | null
> {
	const wanted = [...new Set(currencies)].filter((c) => c !== USD);
	const rowsByCurrency = new Map<
		string,
		{ type: string; rate: number; date: Date }[]
	>();
	if (wanted.length > 0) {
		const rows = await db.exchangeRate.findMany({
			where: { currency: { in: wanted } },
			select: { currency: true, type: true, rate: true, date: true },
		});
		for (const r of rows) {
			const list = rowsByCurrency.get(r.currency) ?? [];
			list.push({ type: r.type, rate: Number(r.rate), date: r.date });
			rowsByCurrency.set(r.currency, list);
		}
	}
	return (currency, date, preferredType) => {
		if (currency === USD) return USD_RATE(date);
		return pickBestRate(rowsByCurrency.get(currency) ?? [], {
			date,
			preferredType,
		});
	};
}

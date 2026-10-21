/**
 * In-memory exchange_rate table for tests. Wires `db.exchangeRate.findMany`
 * to filter a fixed list of rows the way Prisma would for the queries in
 * ~/server/exchange-rates (currency / currency.in, date.lte / date.gt,
 * orderBy date, take).
 *
 * Rates follow the stored convention: fiat = units per USD, crypto = USD per
 * coin.
 */
import type { Mock } from "vitest";

export interface TestRateRow {
	currency: string;
	type: string;
	rate: number;
	date: Date;
}

type FindManyArgs = {
	where?: {
		currency?: string | { in: string[] };
		date?: { lte?: Date; gt?: Date };
	};
	orderBy?: Array<{ date?: "asc" | "desc" }> | { date?: "asc" | "desc" };
	take?: number;
};

export const RATE_DATE = new Date("2026-07-29T00:00:00Z");

/** Today-ish rates for the currencies most tests need. */
export const DEFAULT_RATES: TestRateRow[] = [
	{ currency: "USD", type: "official", rate: 1, date: RATE_DATE },
	{ currency: "ARS", type: "blue", rate: 1560, date: RATE_DATE },
	{ currency: "ARS", type: "official", rate: 1495, date: RATE_DATE },
	{ currency: "ARS", type: "crypto", rate: 1594.68, date: RATE_DATE },
	{ currency: "BRL", type: "official", rate: 5.1178, date: RATE_DATE },
	{ currency: "EUR", type: "official", rate: 0.8787, date: RATE_DATE },
	{ currency: "JPY", type: "official", rate: 163.83, date: RATE_DATE },
	{ currency: "KWD", type: "official", rate: 0.3102, date: RATE_DATE },
	{ currency: "BTC", type: "crypto", rate: 64545.9, date: RATE_DATE },
	{ currency: "ETH", type: "crypto", rate: 1916.61, date: RATE_DATE },
];

/** Applies a Prisma-style exchangeRate.findMany query to a list of rows. */
export function queryRateRows(rows: TestRateRow[], args: FindManyArgs = {}) {
	const where = args.where ?? {};
	let result = rows.filter((r) => {
		if (typeof where.currency === "string" && r.currency !== where.currency)
			return false;
		if (
			where.currency &&
			typeof where.currency === "object" &&
			!where.currency.in.includes(r.currency)
		)
			return false;
		if (where.date?.lte && r.date > where.date.lte) return false;
		if (where.date?.gt && r.date <= where.date.gt) return false;
		return true;
	});
	const order = Array.isArray(args.orderBy)
		? args.orderBy.find((o) => o.date)?.date
		: args.orderBy?.date;
	if (order) {
		result = [...result].sort((a, b) =>
			order === "asc"
				? a.date.getTime() - b.date.getTime()
				: b.date.getTime() - a.date.getTime(),
		);
	}
	if (args.take) result = result.slice(0, args.take);
	return result.map((r) => ({ ...r }));
}

export function useRateTable(
	db: { exchangeRate: { findMany: Mock } },
	rows: TestRateRow[] = DEFAULT_RATES,
) {
	db.exchangeRate.findMany.mockImplementation(async (args: FindManyArgs = {}) =>
		queryRateRows(rows, args),
	);
}

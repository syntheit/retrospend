import { CRYPTO_CURRENCIES, CURRENCIES } from "@retrospend/domain/currencies";
import { currencyDecimals } from "@retrospend/domain/money";
import { env } from "~/env";
import type { db as globalDb } from "~/server/db";
import { findExchangeRate } from "~/server/exchange-rates";
import { IntegrationService } from "~/server/services/integration.service";
import { Prisma } from "~prisma";

type AppDb = typeof globalDb;

/**
 * Reads over the stored exchange rates (quoted per USD) for the tRPC
 * exchange-rate router and /api/v1 currencies and rates. Rates are shared
 * data with no RLS; `rate` is returned as exact decimal text, never a float.
 */

export type RateRow = {
	id: string;
	currency: string;
	type: string;
	date: Date;
	rate: string;
	createdAt: Date;
	updatedAt: Date;
};

/** Decimal text without exponent or trailing zeros ("1450.25", "0.000011"). */
function plain(value: Prisma.Decimal | string): string {
	return new Prisma.Decimal(value).toFixed();
}

/**
 * The newest rate per (currency, type) on or before `onOrBefore` (all
 * dates when absent), sorted by currency then type, starting after `after`.
 */
export async function listLatestRates(
	db: AppDb,
	filter: {
		currency?: string;
		type?: string;
		onOrBefore?: Date;
		after?: { currency: string; type: string } | null;
		take: number;
	},
): Promise<RateRow[]> {
	const where = [
		filter.currency ? Prisma.sql`"currency" = ${filter.currency}` : null,
		filter.type ? Prisma.sql`"type" = ${filter.type}` : null,
		filter.onOrBefore ? Prisma.sql`"date" <= ${filter.onOrBefore}` : null,
	].filter((c): c is Prisma.Sql => c !== null);
	const after = filter.after
		? Prisma.sql`WHERE ("currency", "type") > (${filter.after.currency}, ${filter.after.type})`
		: Prisma.empty;
	const rows = await db.$queryRaw<RateRow[]>`
		SELECT * FROM (
			SELECT DISTINCT ON ("currency", "type")
				"id", "currency", "type", "date", "rate"::text AS "rate",
				"createdAt", "updatedAt"
			FROM "exchange_rate"
			${where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
			ORDER BY "currency", "type", "date" DESC
		) latest
		${after}
		ORDER BY "currency", "type"
		LIMIT ${filter.take}`;
	return rows.map((r) => ({ ...r, rate: plain(r.rate) }));
}

/** One currency's stored rates, newest first (ties by type). */
export async function listRateHistory(
	db: AppDb,
	currency: string,
	filter: {
		type?: string;
		from?: Date;
		to?: Date;
		after?: { date: Date; type: string } | null;
		take: number;
	},
): Promise<RateRow[]> {
	const { after } = filter;
	const rows = await db.exchangeRate.findMany({
		where: {
			currency,
			...(filter.type ? { type: filter.type } : {}),
			date: { gte: filter.from, lte: filter.to },
			...(after
				? {
						OR: [
							{ date: { lt: after.date } },
							{ date: after.date, type: { gt: after.type } },
						],
					}
				: {}),
		},
		orderBy: [{ date: "desc" }, { type: "asc" }],
		take: filter.take,
	});
	return rows.map((r) => ({ ...r, rate: plain(r.rate) }));
}

export type BestRate = {
	currency: string;
	type: string;
	date: Date;
	rate: string;
	exchangeRateId: string | null;
	onOrBefore: boolean;
};

/**
 * The rate the app uses for `currency` on `date` (findExchangeRate's
 * selection), read back from its row so the value is exact. Null when the
 * currency has no rates at all.
 */
export async function getBestRate(
	db: AppDb,
	currency: string,
	date: Date,
	preferredType?: string,
): Promise<BestRate | null> {
	const picked = await findExchangeRate(db, currency, date, preferredType);
	if (!picked) return null;
	const row = await db.exchangeRate.findUnique({
		where: {
			date_currency_type: { date: picked.date, currency, type: picked.type },
		},
		select: { id: true, rate: true },
	});
	return {
		currency,
		type: picked.type,
		date: picked.date,
		// USD has no row: it is 1 per USD by definition.
		rate: row ? plain(row.rate) : "1",
		exchangeRateId: row?.id ?? null,
		onOrBefore: picked.onOrBefore,
	};
}

/** The newest rate day and the last time any rate row changed. */
export async function getRateSyncStatus(db: AppDb) {
	const agg = await db.exchangeRate.aggregate({
		_max: { date: true, updatedAt: true },
	});
	return {
		latestRateDate: agg._max.date ?? null,
		lastUpdatedAt: agg._max.updatedAt ?? null,
	};
}

/** Asks the sidecar to fetch rates now. Throws when the worker refuses. */
export async function requestRateSync(): Promise<void> {
	await IntegrationService.requestWorker(`${env.SIDECAR_URL}/sync-rates`, {
		method: "POST",
	});
}

export type CurrencyInfo = {
	code: string;
	name: string;
	symbol: string;
	symbolNative: string;
	decimals: number;
	kind: "fiat" | "crypto";
	rateTypes: string[];
};

/**
 * Every currency the app knows, sorted by code, with the rate types stored
 * for it. Codes after `afterCode` only.
 */
export async function listCurrencies(
	db: AppDb,
	filter: { kind?: "fiat" | "crypto"; afterCode?: string; take: number },
): Promise<CurrencyInfo[]> {
	const byCode = new Map(
		[
			...Object.values(CURRENCIES).map((c) => ({ c, kind: "fiat" as const })),
			...Object.values(CRYPTO_CURRENCIES).map((c) => ({
				c,
				kind: "crypto" as const,
			})),
		].map((x) => [x.c.code, x]),
	);
	const known = [...byCode.values()]
		.filter((x) => !filter.kind || x.kind === filter.kind)
		.filter((x) => !filter.afterCode || x.c.code > filter.afterCode)
		.sort((a, b) => (a.c.code < b.c.code ? -1 : 1))
		.slice(0, filter.take);
	if (known.length === 0) return [];
	// DISTINCT in SQL: Prisma's `distinct` would load every dated row.
	const pairs = await db.$queryRaw<{ currency: string; type: string }[]>`
		SELECT DISTINCT "currency", "type" FROM "exchange_rate"
		WHERE "currency" IN (${Prisma.join(known.map((x) => x.c.code))})`;
	return known.map(({ c, kind }) => ({
		code: c.code,
		name: c.name,
		symbol: c.symbol,
		symbolNative: c.symbol_native,
		decimals: currencyDecimals(c.code),
		kind,
		rateTypes: pairs
			.filter((p) => p.currency === c.code)
			.map((p) => p.type)
			.sort(),
	}));
}

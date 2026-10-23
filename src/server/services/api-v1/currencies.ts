import type {
	bestRateQuerySchema,
	CursorQuery,
	ExchangeRateDto,
	rateHistoryQuerySchema,
	ratesQuerySchema,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import type { db as globalDb } from "~/server/db";
import {
	getBestRate,
	getRateSyncStatus,
	listCurrencies,
	listLatestRates,
	listRateHistory,
	RateSyncUnavailable,
	requestRateSync,
} from "~/server/services/exchange-rate.service";
import { Prisma } from "~prisma";
import { isoDay } from "./caller";
import { decodeCursor, toPage } from "./cursor";

type AppDb = typeof globalDb;

/** v1 adapters for /currencies and /rates. Rates are shared data (no RLS). */

export function toExchangeRate(row: {
	id: string;
	currency: string;
	type: string;
	date: Date;
	rate: { toString(): string } | string;
	updatedAt: Date;
}): ExchangeRateDto {
	return {
		id: row.id,
		currency: row.currency,
		type: row.type,
		date: isoDay(row.date),
		// Plain notation, never an exponent ("0.000011", not "1.1e-5").
		unitsPerUsd: new Prisma.Decimal(row.rate.toString()).toFixed(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** End of a YYYY-MM-DD day in UTC, where stored rate dates live. */
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999Z`);
const startOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

const codeCursor = z.object({ code: z.string() });

export async function listCurrencyPage(
	db: AppDb,
	q: CursorQuery & { kind?: "fiat" | "crypto" },
) {
	const after = decodeCursor(q.cursor, codeCursor);
	const rows = await listCurrencies(db, {
		kind: q.kind,
		afterCode: after?.code,
		take: q.limit + 1,
	});
	return toPage(
		rows,
		q.limit,
		(c) => ({ code: c.code }),
		(c) => c,
	);
}

const pairCursor = z.object({ currency: z.string(), type: z.string() });

export async function listRatePage(
	db: AppDb,
	q: z.infer<typeof ratesQuerySchema>,
) {
	const after = decodeCursor(q.cursor, pairCursor);
	const rows = await listLatestRates(db, {
		currency: q.currency,
		type: q.type,
		onOrBefore: q.date ? endOfDay(q.date) : undefined,
		after,
		take: q.limit + 1,
	});
	return toPage(
		rows,
		q.limit,
		(r) => ({ currency: r.currency, type: r.type }),
		toExchangeRate,
	);
}

const historyCursor = z.object({ date: z.iso.datetime(), type: z.string() });

export async function listRateHistoryPage(
	db: AppDb,
	currency: string,
	q: z.infer<typeof rateHistoryQuerySchema>,
) {
	const after = decodeCursor(q.cursor, historyCursor);
	const rows = await listRateHistory(db, currency, {
		type: q.type,
		from: q.from ? startOfDay(q.from) : undefined,
		to: q.to ? endOfDay(q.to) : undefined,
		after: after ? { date: new Date(after.date), type: after.type } : null,
		take: q.limit + 1,
	});
	return toPage(
		rows,
		q.limit,
		(r) => ({ date: r.date.toISOString(), type: r.type }),
		toExchangeRate,
	);
}

export async function readBestRate(
	db: AppDb,
	currency: string,
	q: z.infer<typeof bestRateQuerySchema>,
) {
	const date = q.date ? endOfDay(q.date) : new Date();
	const best = await getBestRate(db, currency, date, q.type);
	if (!best) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `No rates stored for ${currency}`,
		});
	}
	return {
		currency: best.currency,
		type: best.type,
		date: isoDay(best.date),
		unitsPerUsd: best.rate,
		exchangeRateId: best.exchangeRateId,
		onOrBefore: best.onOrBefore,
	};
}

export async function readSyncStatus(db: AppDb) {
	const status = await getRateSyncStatus(db);
	return {
		latestRateDate: status.latestRateDate
			? isoDay(status.latestRateDate)
			: null,
		lastUpdatedAt: status.lastUpdatedAt?.toISOString() ?? null,
	};
}

export async function startRateSync() {
	try {
		await requestRateSync();
	} catch (error) {
		// No sidecar here: a stable problem code, not a bare 500.
		if (error instanceof RateSyncUnavailable)
			throw new TRPCError({ code: "NOT_IMPLEMENTED", message: error.message });
		throw error;
	}
	return { ok: true as const };
}

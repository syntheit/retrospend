import { createHash } from "node:crypto";
import type {
	DailyRatesDto,
	HistoryRateDto,
	rateDaysQuerySchema,
} from "@retrospend/api-contract";
import { USD } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import * as z from "zod";
import type { db as globalDb } from "~/server/db";
import { isoDay } from "./caller";
import { decodeCursor, toPage } from "./cursor";

type AppDb = typeof globalDb;

/**
 * Rate reads for devices (E2EE lane P, P15). Rates are shared data with no
 * owner, so any caller reads the same rows; a device prices with them locally.
 */

/**
 * Every exchange_rate row, in one statement so the sidecar rewriting rows in
 * place never shows through half old and half new. The same rows the server's
 * figures read (findRateRows), ordered by currency, type and date; USD never
 * has one. Every stored rate is above zero (a CHECK on the column), which is
 * what a device requires of each row. The ETag hashes the body, so any change
 * to any row changes it.
 */
export async function readDailyRates(
	db: AppDb,
): Promise<{ body: DailyRatesDto; etag: string }> {
	const rows = await db.exchangeRate.findMany({
		where: { currency: { not: USD } },
		orderBy: [{ currency: "asc" }, { type: "asc" }, { date: "asc" }],
	});
	let newest: Date | null = null;
	for (const r of rows)
		if (!newest || r.updatedAt > newest) newest = r.updatedAt;
	const body: DailyRatesDto = {
		asOf: newest ? newest.toISOString() : null,
		rates: rows.map((r) => ({
			id: r.id,
			currency: r.currency,
			type: r.type,
			date: r.date.toISOString(),
			// Plain notation, never an exponent.
			unitsPerUsd: dec(r.rate).toFixed(),
			updatedAt: r.updatedAt.toISOString(),
		})),
	};
	const digest = createHash("sha256")
		.update(JSON.stringify(body))
		.digest("base64url");
	return { body, etag: `"${digest}"` };
}

const dayCursor = z.object({
	date: z.iso.date(),
	currency: z.string(),
	type: z.string(),
});

/** One page of rate history, oldest first by (date, currency, type). */
export async function listHistoryRatePage(
	db: AppDb,
	q: z.infer<typeof rateDaysQuerySchema>,
) {
	const after = decodeCursor(q.cursor, dayCursor);
	const rows = await db.exchangeRateHistory.findMany({
		where: {
			date: { gte: new Date(q.from), lte: new Date(q.to) },
			...(after
				? {
						OR: [
							{ date: { gt: new Date(after.date) } },
							{
								date: new Date(after.date),
								currency: { gt: after.currency },
							},
							{
								date: new Date(after.date),
								currency: after.currency,
								type: { gt: after.type },
							},
						],
					}
				: {}),
		},
		orderBy: [{ date: "asc" }, { currency: "asc" }, { type: "asc" }],
		take: q.limit + 1,
	});
	return toPage(
		rows,
		q.limit,
		(r) => ({ date: isoDay(r.date), currency: r.currency, type: r.type }),
		(r): HistoryRateDto => ({
			date: isoDay(r.date),
			currency: r.currency,
			type: r.type,
			unitsPerUsd: dec(r.rate).toFixed(),
		}),
	);
}

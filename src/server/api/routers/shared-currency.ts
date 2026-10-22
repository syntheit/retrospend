import { findExchangeRate } from "~/server/exchange-rates";
import type { PrismaClient } from "~prisma";

/**
 * Fetches the best available exchange rate for a currency on a given date.
 * Priority: "blue" > "official" > "crypto" > first available. Falls back to
 * the nearest rate after the date when none exists on or before it.
 */
export async function getBestExchangeRate(
	db: PrismaClient,
	currency: string,
	date: Date,
): Promise<{ rate: number; type: string } | null> {
	return findExchangeRate(db, currency, date);
}

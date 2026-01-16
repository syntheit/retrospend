import "server-only";
import { db } from "~/server/db";
// biome-ignore lint/style/useImportType: Prisma namespace import
import { Prisma } from "~prisma";

const VALID_CURRENCY = /^[A-Z]{3}$/;
const VALID_TYPE = /^[a-z0-9_-]{1,32}$/;
const MAX_RATE_ENTRIES = 2000;
const FETCH_TIMEOUT_MS = 8000;

interface OracleRatesResponse {
	updatedAt: string;
	base: string;
	rates: Record<string, number>;
}

interface ParsedRate {
	currency: string;
	type: string;
	rate: number;
}

function parseRateKey(key: string): { currency: string; type: string } {
	const parts = key.split("_");
	if (parts.length === 1) {
		return { currency: key, type: "official" };
	}

	const currency = parts[0] || key;
	const type = parts.slice(1).join("_").toLowerCase();

	return { currency, type };
}

async function syncExchangeRates(): Promise<number> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		// Fetch data from Oracle JSON
		const response = await fetch(
			"https://raw.githubusercontent.com/syntheit/exchange-rates/refs/heads/main/rates.json",
			{
				cache: "no-store",
				headers: {
					"Content-Type": "application/json",
				},
				signal: controller.signal,
			},
		);
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(
				`Failed to fetch exchange rates: ${response.status} ${response.statusText}`,
			);
		}

		const data: OracleRatesResponse = await response.json();

		if (!data.rates || typeof data.rates !== "object") {
			throw new Error(
				"Invalid response format: missing or invalid rates object",
			);
		}

		// Parse and prepare rate entries
		const rateEntries: ParsedRate[] = [];

		// Use today's date as the effective date for all rates
		const effectiveDate = new Date();
		effectiveDate.setUTCHours(0, 0, 0, 0); // Normalize to midnight UTC

		for (const [key, rate] of Object.entries(data.rates)) {
			if (typeof rate !== "number" || Number.isNaN(rate)) {
				continue;
			}

			const { currency, type } = parseRateKey(key);
			const normalizedCurrency = currency.toUpperCase();
			const normalizedType = type.toLowerCase();

			if (!VALID_CURRENCY.test(normalizedCurrency)) {
				continue;
			}

			if (!VALID_TYPE.test(normalizedType)) {
				continue;
			}

			rateEntries.push({
				currency: normalizedCurrency,
				type: normalizedType,
				rate,
			});
		}

		if (rateEntries.length === 0) {
			throw new Error("No valid rate entries found in response");
		}

		if (rateEntries.length > MAX_RATE_ENTRIES) {
			throw new Error(
				`Too many rate entries (${rateEntries.length}), aborting sync`,
			);
		}

		// Fetch all existing rates to intelligently update/cleanup
		// We need to handle potential duplicates from previous bad syncs
		const existingRates = await db.exchangeRate.findMany({
			select: {
				id: true,
				currency: true,
				type: true,
				_count: {
					select: { favorites: true },
				},
			},
		});

		// Group by currency+type
		const existingMap = new Map<
			string,
			Array<{
				id: string;
				currency: string;
				type: string;
				_count: { favorites: number };
			}>
		>();

		for (const rate of existingRates) {
			const key = `${rate.currency}_${rate.type}`;
			const list = existingMap.get(key) ?? [];
			list.push(rate);
			existingMap.set(key, list);
		}

		// Prepare operations
		const idsToDelete = new Set<string>();
		const validIds = new Set<string>();
		const updates: Prisma.PrismaPromise<unknown>[] = [];
		const creates: {
			date: Date;
			currency: string;
			type: string;
			rate: number;
		}[] = [];

		for (const entry of rateEntries) {
			const key = `${entry.currency}_${entry.type}`;
			const existing = existingMap.get(key);

			if (existing && existing.length > 0) {
				// Sort to find the best candidate to keep:
				// 1. Has favorites (highest preference)
				// 2. Already matches our target date (minor optimization)
				// 3. ID lexical order (deterministic fallback)
				existing.sort((a, b) => {
					if (a._count.favorites !== b._count.favorites) {
						return b._count.favorites - a._count.favorites; // Descending
					}
					return a.id.localeCompare(b.id);
				});

				const keeper = existing[0];
				if (!keeper) continue; // Should not happen given check above

				// Queue update for the keeper
				updates.push(
					db.exchangeRate.update({
						where: { id: keeper.id },
						data: {
							rate: entry.rate,
							date: effectiveDate,
						},
					}),
				);
				validIds.add(keeper.id);

				// Mark others for deletion (duplicates)
				for (let i = 1; i < existing.length; i++) {
					const duplicate = existing[i];
					if (duplicate) {
						idsToDelete.add(duplicate.id);
					}
				}
			} else {
				// New rate
				creates.push({
					date: effectiveDate,
					currency: entry.currency,
					type: entry.type,
					rate: entry.rate,
				});
			}
		}

		// Identify stale rates (in DB but not in new payload)
		// Any ID in existingRates that is NOT in validIds and NOT in idsToDelete (implicit) needs to be deleted
		for (const rate of existingRates) {
			if (!validIds.has(rate.id)) {
				idsToDelete.add(rate.id);
			}
		}

		// Execute all operations
		await db.$transaction([
			// 1. Delete duplicates and stale records
			...(idsToDelete.size > 0
				? [
						db.exchangeRate.deleteMany({
							where: {
								id: { in: Array.from(idsToDelete) },
							},
						}),
					]
				: []),
			// 2. Update existing records (one by one as updates are unique)
			...updates,
			// 3. Create new records (batch)
			...(creates.length > 0
				? [db.exchangeRate.createMany({ data: creates })]
				: []),
		]);

		return rateEntries.length;
	} catch (error) {
		throw new Error(
			`Exchange rate sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	} finally {
		clearTimeout(timeoutId);
	}
}

export { syncExchangeRates };

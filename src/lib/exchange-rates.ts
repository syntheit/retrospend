import "server-only";
import { db } from "~/server/db";

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

		// Truncate + reload to avoid any duplicates or drifted timestamps
		await db.$transaction([
			db.exchangeRate.deleteMany(),
			db.exchangeRate.createMany({
				data: rateEntries.map(({ currency, type, rate }) => ({
					date: effectiveDate,
					currency,
					type,
					rate,
				})),
				// Defensive: in case of concurrent runs with the same payload
				skipDuplicates: true,
			}),
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

import type { PrismaClient } from "~prisma";
import { getBestExchangeRate } from "../api/routers/shared-currency";

type RateResult = { rate: number; type: string } | null;

/**
 * Request-scoped exchange rate cache.
 * Eliminates redundant DB lookups when the same currency+date
 * is needed by multiple services within a single request.
 *
 * Stores Promises to deduplicate concurrent in-flight requests
 * for the same key (e.g. when Promise.all kicks off parallel services).
 */
export class RateCache {
	private cache = new Map<string, Promise<RateResult>>();

	constructor(private db: PrismaClient) {}

	private key(currency: string, date: Date): string {
		return `${currency}:${date.toISOString().slice(0, 10)}`;
	}

	async get(currency: string, date: Date): Promise<RateResult> {
		if (currency === "USD") return { rate: 1, type: "official" };

		const k = this.key(currency, date);
		const existing = this.cache.get(k);
		if (existing) return existing;

		const promise = getBestExchangeRate(this.db, currency, date);
		this.cache.set(k, promise);
		return promise;
	}

	async getMany(
		currencies: string[],
		date: Date,
	): Promise<Map<string, RateResult>> {
		const results = new Map<string, RateResult>();
		const toFetch: { currency: string; promise: Promise<RateResult> }[] = [];

		for (const currency of currencies) {
			if (currency === "USD") {
				results.set(currency, { rate: 1, type: "official" });
				continue;
			}
			const k = this.key(currency, date);
			const existing = this.cache.get(k);
			if (existing) {
				toFetch.push({ currency, promise: existing });
			} else {
				const promise = getBestExchangeRate(this.db, currency, date);
				this.cache.set(k, promise);
				toFetch.push({ currency, promise });
			}
		}

		const fetched = await Promise.all(toFetch.map((f) => f.promise));
		for (let i = 0; i < toFetch.length; i++) {
			results.set(toFetch[i]!.currency, fetched[i] ?? null);
		}

		return results;
	}
}

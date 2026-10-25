/**
 * Test fixtures for the envelope modules: a small rate table in the stored
 * convention of @retrospend/domain/money (fiat: units per USD; crypto: USD per coin) and
 * builders. Values follow the SPEC's illustrative rates (ARS blue 1,465,
 * BRL 5.40). CLP has no rate on purpose (the missing-rate story, C18).
 */

import type { IsoDate } from "./types";
import type { UsdRateLookup, ValuationContext } from "./valuation";

type RateTable = Record<string, Record<string, Array<[IsoDate, string]>>>;

/** Rates in force from each date (latest on or before the asked date wins). */
export const RATES: RateTable = {
	ARS: {
		official: [
			["2026-01-01", "1380"],
			["2026-10-01", "1412"],
		],
		blue: [
			["2026-01-01", "1400"],
			["2026-10-01", "1465"],
			["2027-01-01", "1530"],
		],
	},
	BRL: { official: [["2026-01-01", "5.40"]] },
	EUR: { official: [["2026-01-01", "0.92"]] },
	JPY: { official: [["2026-01-01", "150.25"]] },
	KWD: { official: [["2026-01-01", "0.3075"]] },
	BTC: { market: [["2026-01-01", "64545"]] },
};

export function lookupIn(table: RateTable): UsdRateLookup {
	return (currency, rateType, date) => {
		const rows = table[currency]?.[rateType];
		if (!rows) return null;
		let found: string | null = null;
		for (const [from, rate] of rows) if (from <= date) found = rate;
		return found;
	};
}

export function bookContext(
	bookCurrency: string,
	overrides: Partial<ValuationContext> = {},
): ValuationContext {
	return {
		bookCurrency,
		periods: [],
		defaultRateType: "official",
		usdRate: lookupIn(RATES),
		...overrides,
	};
}

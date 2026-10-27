/**
 * What the Currencies page renders, as the server builds it
 * (server/view-model.ts). Prices are rates, computed
 * on the server from the rate table; the client formats them only (R9).
 * Each row reads "1 {home} = {price} {code}": the price is in the row's
 * currency, for one unit of the home currency.
 */
import type { MoneyValue } from "~/components/money/format";

/**
 * A rate in the row's own currency: Money whose `minor` counts `places`
 * decimal digits (at least the currency's own), so USD 0.00064 is
 * { minor: 64, places: 5 }. Format it with `places`.
 */
export type RatePrice = MoneyValue & { places: number };

/** The column key a coin's market price sits in (its own type is "crypto"). */
export const MARKET = "market";

export type CurrencyRow = {
	code: string;
	crypto: boolean;
	/** The rate types this currency is priced at, in column order. */
	types: string[];
	/** What 1 unit of the home currency buys in this currency, per rate type. */
	prices: Record<string, RatePrice>;
	/** Types priced through another type's rate (one side lacks the type). */
	derived: string[];
	/** The type new amounts use; null with no rate. */
	defaultType: string | null;
	favorite: boolean;
	/** Exchange rate row to favorite (null: nothing to favorite yet). */
	rateId: string | null;
	/** Favorite rows to remove when unfavoriting. */
	favoriteIds: string[];
	/** Open accounts in this currency (named when it has no rate). */
	usedBy: string[];
};

export type CurrenciesView = {
	home: string;
	columns: string[];
	rows: CurrencyRow[];
	/** ISO date of the newest rate. */
	updated: string | null;
	/** The type new foreign amounts use, for the header line. */
	homeDefault: string | null;
	/** Whether the default can be changed yet (the seam, rate-default-seam.ts). */
	canSetDefault: boolean;
};

export type ConvertDirection = "toHome" | "fromHome";

export type ConvertResult = {
	type: string;
	value: MoneyValue;
	/** Converted through another type's rate (one side lacks the type). */
	derived: boolean;
}[];

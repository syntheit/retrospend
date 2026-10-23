/**
 * What the Currencies page renders, as the server builds it
 * (server/view-model.ts). Prices are Money in the home currency, computed
 * on the server from the rate table; the client formats them only (R9).
 */
import type { MoneyValue } from "~/components/money/format";

/** The column key a coin's market price sits in (its own type is "crypto"). */
export const MARKET = "market";

export type CurrencyRow = {
	code: string;
	crypto: boolean;
	/** The rate types this currency is priced at, in column order. */
	types: string[];
	/** Price of 1 unit in the home currency, per rate type. */
	prices: Record<string, MoneyValue>;
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

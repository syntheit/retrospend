/**
 * What the Currencies page renders, as the server builds it
 * (server/view-model.ts). Prices are rates, computed on the server from the
 * rate table; the client formats them only (R9). Each price prices the
 * stronger currency of the pair in the weaker one ("1 USD = ARS 1,555",
 * "1 KWD = USD 3.26"): `base` says which one is the single unit.
 */
import type { MoneyValue } from "~/components/money/format";

/**
 * A rate as Money: `minor` counts `places` decimal digits (at least the
 * currency's own), so USD 0.00064 is { minor: 64, places: 5 }. Format it
 * with `places`.
 */
export type Rate = MoneyValue & { places: number };

/** A price: `base` is worth 1 unit, the Money is what it costs in the other currency. */
export type RatePrice = Rate & { base: string };

/** The column key a coin's market price sits in (its own type is "crypto"). */
export const MARKET = "market";

export type CurrencyRow = {
	code: string;
	crypto: boolean;
	/** The rate types this currency is priced at, in column order. */
	types: string[];
	/** The price of the stronger currency of the pair, per rate type. */
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
	/** The one unit every price shares ("1 USD in ..."), or null when they differ. */
	base: string | null;
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

/** The ranges the history chart offers; ALL is every stored day. */
export const HISTORY_RANGES = ["1M", "3M", "1Y", "ALL"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** One day of a rate type's history, priced like the page's prices. */
export type HistoryPoint = {
	/** ISO day. */
	date: string;
	price: Rate;
};

/** A rate type's days in the range, oldest first. */
export type HistorySeries = {
	type: string;
	/** Priced through another type's rate (one side lacks this type). */
	derived: boolean;
	/** Change from the first to the last day, in hundredths of a percent; null with one day. */
	changeBp: number | null;
	points: HistoryPoint[];
};

/**
 * A currency's history against the home currency: every point is the same
 * unit as the page's price (`base` is worth 1; the Money is what it costs in
 * the other currency of the pair) at the same `places`, so the line is
 * comparable between points and rate types.
 */
export type RateHistory = {
	currency: string;
	home: string;
	range: HistoryRange;
	/** The one unit every point shares; null with no history. */
	base: string | null;
	/** The type the chart opens on; null with no history. */
	defaultType: string | null;
	series: HistorySeries[];
};

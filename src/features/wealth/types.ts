/**
 * What the Wealth page renders, as the server builds it (server/view-model.ts).
 * Every amount is a Money DTO in minor units and every share is in
 * hundredths of a percent: the client formats, it never computes (R9).
 */
import type { MoneyValue } from "~/components/money/format";
import type { AccountKind, Basis } from "~/components/rows/types";

export type AssetTypeKey =
	| "CASH"
	| "INVESTMENT"
	| "CRYPTO"
	| "REAL_ESTATE"
	| "VEHICLE"
	| "LIABILITY_LOAN"
	| "LIABILITY_CREDIT_CARD"
	| "LIABILITY_MORTGAGE";

export type GroupKey =
	| "cash"
	| "investments"
	| "crypto"
	| "property"
	| "liabilities";

export type WealthAccount = {
	id: string;
	name: string;
	type: AssetTypeKey;
	kind: AccountKind;
	group: GroupKey;
	/** Native amount; liabilities are negative. */
	amount: MoneyValue;
	/** The sign the balance is stored with, so a write keeps it (liabilities only). */
	storedSign: 1 | -1;
	/** Home value: undefined in the home currency, null with no rate. */
	home?: MoneyValue | null;
	liquid: boolean;
	/** The rate type the account is valued at, when its currency has several. */
	rateType: string | null;
	/** Every rate type the server has for the account's currency. */
	rateTypes: string[];
	/** Interest rate of a liability, as typed (118 is 118%). */
	apr: number | null;
	/** ISO date of the last change. */
	updated: string;
	/** ISO date it was closed; null while open. */
	closedOn: string | null;
};

export type WealthGroup = {
	key: GroupKey;
	/** Sum of the group's home values; accounts without a rate are left out. */
	total: MoneyValue;
	accounts: WealthAccount[];
};

/** One slice of a breakdown: a group key, a currency code or "liquid"/"illiquid". */
export type WealthShare = {
	key: string;
	value: MoneyValue;
	share: Basis;
	/** Series slot (groups only), largest first. */
	series?: number;
};

export const RANGES = ["1M", "3M", "6M", "1Y"] as const;
export type WealthRange = (typeof RANGES)[number];

export type WealthPoint = { date: string; value: MoneyValue };

export type WealthView = {
	home: string;
	/** ISO date of today on the server. */
	today: string;
	netWorth: MoneyValue;
	/** The change over 30 days; null with no history that old. */
	change30: { amount: MoneyValue; basis: Basis | null } | null;
	series: Record<WealthRange, WealthPoint[]>;
	groups: WealthGroup[];
	closed: WealthAccount[];
	liquid: MoneyValue;
	/** Months the liquid assets last at the average monthly spending. */
	runway: { months: number; monthly: MoneyValue } | null;
	allocation: WealthShare[];
	breakdown: {
		byType: WealthShare[];
		byCurrency: WealthShare[];
		byLiquidity: WealthShare[];
	};
	/** Open accounts left out of net worth for want of a rate. */
	missingRates: number;
	/** ISO date of the newest rate on the server. */
	ratesUpdated: string | null;
	/** The user's "hide amounts" default. */
	hideAmounts: boolean;
	/** Rate types per currency, for the account sheets. */
	rateTypes: Record<string, string[]>;
};

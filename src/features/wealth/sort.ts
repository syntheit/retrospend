import type { WealthAccount } from "./types";

export const WEALTH_SORTS = ["balance", "name", "type", "updated"] as const;
export type WealthSort = (typeof WEALTH_SORTS)[number];

/** The sort a viewer last picked, remembered in this cookie (read on the server, so no flash). */
export const WEALTH_SORT_COOKIE = "rs-wealth-sort";

export const DEFAULT_SORT: WealthSort = "balance";

export function readSort(value: string | undefined | null): WealthSort {
	return WEALTH_SORTS.find((s) => s === value) ?? DEFAULT_SORT;
}

const TYPE_ORDER: Record<WealthAccount["type"], number> = {
	CASH: 0,
	INVESTMENT: 1,
	CRYPTO: 2,
	REAL_ESTATE: 3,
	VEHICLE: 4,
	LIABILITY_LOAN: 5,
	LIABILITY_CREDIT_CARD: 6,
	LIABILITY_MORTGAGE: 7,
};

/**
 * What the account counts for, in minor units of the home currency, by size
 * (a debt by what is owed). An account with no rate sorts last, never as zero.
 */
function size(a: WealthAccount): number | null {
	const v = a.home === undefined ? a.amount : a.home;
	return v === null ? null : Math.abs(v.minor);
}

/**
 * Orders the accounts of one group. Balance: largest first by home value.
 * Name: A to Z. Type: the kinds in the order of the groups, then by name.
 * Updated: newest change first. Ties fall back to the name, so the order is
 * stable between reloads.
 */
export function sortAccounts(
	accounts: readonly WealthAccount[],
	sort: WealthSort,
	locale: string,
): WealthAccount[] {
	const byName = (x: WealthAccount, y: WealthAccount) =>
		x.name.localeCompare(y.name, locale, { sensitivity: "base" });
	const compare = (x: WealthAccount, y: WealthAccount): number => {
		switch (sort) {
			case "name":
				return byName(x, y);
			case "type":
				return TYPE_ORDER[x.type] - TYPE_ORDER[y.type];
			case "updated":
				return x.updated === y.updated ? 0 : x.updated < y.updated ? 1 : -1;
			case "balance": {
				const a = size(x);
				const b = size(y);
				if (a === b) return 0;
				if (a === null) return 1;
				if (b === null) return -1;
				return b - a;
			}
		}
	};
	return [...accounts].sort((x, y) => compare(x, y) || byName(x, y));
}

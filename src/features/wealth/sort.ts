import { ACCOUNT_SORTS } from "@retrospend/api-contract";
import {
	moveInOrder as moveIn,
	type SortFacts,
	sortAccounts as sort,
} from "@retrospend/domain/account-sort";
import type { WealthAccount } from "./types";

/**
 * The sort modes (Spotify's model): Custom follows the order you set by
 * dragging, the rest sort by a fact of the account. The mode and the custom
 * order are saved on the server per person (accounts/order), so switching
 * away from Custom and back restores the order exactly. The ordering itself
 * is shared with the phone (domain/account-sort).
 */
export const WEALTH_SORTS = ACCOUNT_SORTS;
export type WealthSort = (typeof WEALTH_SORTS)[number];

export const DEFAULT_SORT: WealthSort = "value";

/** What the account counts for: its home value by size (a debt by what is owed); no rate is null. */
function facts(a: WealthAccount): SortFacts {
	const v = a.home === undefined ? a.amount : a.home;
	return {
		id: a.id,
		name: a.name,
		type: a.type,
		size: v === null ? null : Math.abs(v.minor),
		updated: a.updated,
	};
}

export function sortAccounts(
	accounts: readonly WealthAccount[],
	mode: WealthSort,
	locale: string,
	custom: readonly string[] = [],
): WealthAccount[] {
	return sort(accounts, mode, locale, custom, facts);
}

export function moveInOrder(
	all: readonly WealthAccount[],
	custom: readonly string[],
	locale: string,
	shown: readonly string[],
	from: number,
	to: number,
): string[] {
	return moveIn(all, custom, locale, shown, from, to, facts);
}

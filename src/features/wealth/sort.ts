import { ACCOUNT_SORTS } from "@retrospend/api-contract";
import type { WealthAccount } from "./types";

/**
 * The sort modes (Spotify's model): Custom follows the order you set by
 * dragging, the rest sort by a fact of the account. The mode and the custom
 * order are saved on the server per person (accounts/order), so switching
 * away from Custom and back restores the order exactly.
 */
export const WEALTH_SORTS = ACCOUNT_SORTS;
export type WealthSort = (typeof WEALTH_SORTS)[number];

export const DEFAULT_SORT: WealthSort = "value";

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
 * Orders the accounts of one group. Value: largest first by home value.
 * Name: A to Z. Type: the kinds in the order of the groups, then by name.
 * Updated: newest change first. Custom: the order you set; an account you
 * have not placed yet follows the placed ones, largest first. Ties fall back
 * to the name, so the order is stable between reloads.
 */
export function sortAccounts(
	accounts: readonly WealthAccount[],
	sort: WealthSort,
	locale: string,
	custom: readonly string[] = [],
): WealthAccount[] {
	const rank = new Map(custom.map((id, i) => [id, i]));
	const byName = (x: WealthAccount, y: WealthAccount) =>
		x.name.localeCompare(y.name, locale, { sensitivity: "base" });
	const bySize = (x: WealthAccount, y: WealthAccount) => {
		const a = size(x);
		const b = size(y);
		if (a === b) return 0;
		if (a === null) return 1;
		if (b === null) return -1;
		return b - a;
	};
	const compare = (x: WealthAccount, y: WealthAccount): number => {
		switch (sort) {
			case "name":
				return byName(x, y);
			case "type":
				return TYPE_ORDER[x.type] - TYPE_ORDER[y.type];
			case "updated":
				return x.updated === y.updated ? 0 : x.updated < y.updated ? 1 : -1;
			case "value":
				return bySize(x, y);
			case "custom": {
				const a = rank.get(x.id);
				const b = rank.get(y.id);
				if (a !== undefined && b !== undefined) return a - b;
				if (a !== undefined) return -1;
				if (b !== undefined) return 1;
				return bySize(x, y);
			}
		}
	};
	return [...accounts].sort((x, y) => compare(x, y) || byName(x, y));
}

/**
 * The custom order after one account moves inside a group. `all` is every
 * account the page knows, `shown` the ids of the group as listed now. Only
 * the slots the shown accounts hold are refilled, so accounts of other
 * groups, hidden by a filter or closed keep their places.
 */
export function moveInOrder(
	all: readonly WealthAccount[],
	custom: readonly string[],
	locale: string,
	shown: readonly string[],
	from: number,
	to: number,
): string[] {
	const full = sortAccounts(all, "custom", locale, custom).map((a) => a.id);
	const moved = [...shown];
	const [id] = moved.splice(from, 1);
	if (id === undefined) return full;
	moved.splice(to, 0, id);
	const slots = full.flatMap((x, i) => (shown.includes(x) ? [i] : []));
	const next = [...full];
	slots.forEach((slot, i) => {
		next[slot] = moved[i] ?? next[slot] ?? "";
	});
	return next;
}

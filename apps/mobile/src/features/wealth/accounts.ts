import {
	type AccountSortMode,
	moveInOrder as moveIn,
	type SortFacts,
	sortAccounts as sort,
} from "@retrospend/domain/account-sort";
import type { GlyphName } from "@/ui/Glyph";
import type { Account } from "./source";

// How the accounts list is grouped. A group's total is the server's (the
// summary): a sum of accounts in several currencies is a figure only the
// server works out.

export const GROUPS = [
	"cash",
	"investments",
	"crypto",
	"property",
	"liabilities",
] as const;
export type AccountGroup = (typeof GROUPS)[number];

const GROUP_OF: Record<Account["type"], AccountGroup> = {
	CASH: "cash",
	INVESTMENT: "investments",
	CRYPTO: "crypto",
	REAL_ESTATE: "property",
	VEHICLE: "property",
	LIABILITY_LOAN: "liabilities",
	LIABILITY_CREDIT_CARD: "liabilities",
	LIABILITY_MORTGAGE: "liabilities",
};

export function groupOf(type: Account["type"]): AccountGroup {
	return GROUP_OF[type];
}

export function isLiability(type: Account["type"]): boolean {
	return GROUP_OF[type] === "liabilities";
}

export interface AccountSection {
	group: AccountGroup;
	accounts: Account[];
}

/** Open accounts by group, in a fixed order; the server's order inside a group. */
export function sectionsOf(accounts: readonly Account[]): AccountSection[] {
	return GROUPS.flatMap((group) => {
		const inGroup = accounts.filter(
			(a) => a.closedAt === null && GROUP_OF[a.type] === group,
		);
		return inGroup.length > 0 ? [{ group, accounts: inGroup }] : [];
	});
}

/** Accounts whose name holds the typed text, ignoring case and accents; all of them with no text. */
export function matchingAccounts(
	accounts: readonly Account[],
	query: string,
): Account[] {
	const fold = (text: string) =>
		text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	const needle = fold(query.trim());
	return needle === ""
		? [...accounts]
		: accounts.filter((a) => fold(a.name).includes(needle));
}

export function closedAccounts(accounts: readonly Account[]): Account[] {
	return accounts.filter((a) => a.closedAt !== null);
}

/** Open accounts the server could not value (no rate): they are left out of net worth. */
export function unvalued(accounts: readonly Account[]): Account[] {
	return accounts.filter((a) => a.closedAt === null && a.value === null);
}

/** The neutral tile's glyph for a kind of account (rows only, never color). */
export function glyphOf(type: Account["type"]): GlyphName {
	switch (type) {
		case "CASH":
			return "Landmark";
		case "INVESTMENT":
			return "ChartNoAxesCombined";
		case "CRYPTO":
			return "Bitcoin";
		case "REAL_ESTATE":
			return "Building2";
		case "VEHICLE":
			return "Car";
		case "LIABILITY_LOAN":
			return "HandCoins";
		case "LIABILITY_CREDIT_CARD":
			return "CreditCard";
		case "LIABILITY_MORTGAGE":
			return "Home";
	}
}

/**
 * A yearly percent as the server stores it ("24.5") in hundredths of a
 * percent (2450), for the percent formatter. Read from the text, so no float
 * touches it; digits past the second are dropped. Null when it is not a number.
 */
export function aprBasis(text: string | null): number | null {
	if (text === null) return null;
	const match = /^(\d{1,3})(?:\.(\d+))?$/.exec(text.trim());
	if (!match) return null;
	const whole = Number(match[1]);
	const fraction = Number(`${match[2] ?? ""}00`.slice(0, 2));
	return whole * 100 + fraction;
}

/** What the order needs to know: the home value by size (a debt by what is owed), none without a rate. */
function facts(a: Account): SortFacts {
	return {
		id: a.id,
		name: a.name,
		type: a.type,
		size: a.value === null ? null : Math.abs(a.value.minor),
		updated: a.updatedAt,
	};
}

/** The accounts of one group in the chosen sort; Custom follows the saved order (domain/account-sort). */
export function sortedAccounts(
	accounts: readonly Account[],
	mode: AccountSortMode,
	locale: string,
	custom: readonly string[],
): Account[] {
	return sort(accounts, mode, locale, custom, facts);
}

/** The whole custom order after the account at `from` moves to `to` inside the group `shown`. */
export function movedOrder(
	all: readonly Account[],
	custom: readonly string[],
	locale: string,
	shown: readonly string[],
	from: number,
	to: number,
): string[] {
	return moveIn(all, custom, locale, shown, from, to, facts);
}

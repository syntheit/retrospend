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

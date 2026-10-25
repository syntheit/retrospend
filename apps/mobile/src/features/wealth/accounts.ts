import type { Account } from "./source";

// How the accounts list is grouped. Groups carry a count, never a total: a
// sum of accounts in several currencies is a figure only the server works out.

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

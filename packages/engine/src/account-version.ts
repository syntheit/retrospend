/**
 * A local account version, as a placeholder. The database trigger
 * `asset_account_version_moves` adds 1 to an account's version when one of
 * ACCOUNT_VERSION_COLUMNS changes value (or the stored rate does while the
 * rate type is custom); the device applies the same rule to its own copy each
 * time one of its writes changes the row, so a chain of local writes to one
 * account reads in order. It never claims to know the server's version: the
 * server's answer names it, and the ack adopts it (PR6 of slice-device-wealth,
 * the M5 rule of one ack version per row). This is the only place a local
 * version moves, so that adoption has one seam.
 */
import {
	ACCOUNT_VERSION_COLUMNS,
	ACCOUNT_VERSION_WHEN_RATE_TYPE,
	type AccountVersionColumn,
	type AccountVersionConditional,
} from "@retrospend/domain/accounts/version-columns";
import { dec } from "@retrospend/domain/precise-decimal";
import type { AccountRow } from "./accounts";

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Decimal columns compare by value, as `IS DISTINCT FROM` on numeric does ("24.5" equals "24.500000"). */
const sameDecimal = (
	a: string | null | undefined,
	b: string | null | undefined,
) => (a == null || b == null ? (a ?? null) === (b ?? null) : dec(a).eq(dec(b)));

/** One comparison per version column; a column added to the constant fails to compile here. */
const COLUMN_SAME: Record<
	AccountVersionColumn,
	(a: AccountRow, b: AccountRow) => boolean
> = {
	type: (a, b) => a.type === b.type,
	currency: (a, b) => a.currency === b.currency,
	exchangeRateType: (a, b) => same(a.exchangeRateType, b.exchangeRateType),
	closedAt: (a, b) => same(a.closedAt?.getTime(), b.closedAt?.getTime()),
	inBudget: (a, b) => same(a.inBudget, b.inBudget),
	isLiquid: (a, b) => a.isLiquid === b.isLiquid,
	interestRate: (a, b) => sameDecimal(a.interestRate, b.interestRate),
	minimumPayment: (a, b) => sameDecimal(a.minimumPayment, b.minimumPayment),
	dueDate: (a, b) => same(a.dueDate, b.dueDate),
};

/** The columns that count only while the new rate type is the key. */
const CONDITIONAL_SAME: Record<
	AccountVersionConditional,
	(a: AccountRow, b: AccountRow) => boolean
> = {
	exchangeRate: (a, b) => sameDecimal(a.exchangeRate, b.exchangeRate),
};

/** Whether the trigger would add 1 for this update. */
export function movesVersion(before: AccountRow, after: AccountRow): boolean {
	if (ACCOUNT_VERSION_COLUMNS.some((c) => !COLUMN_SAME[c](before, after)))
		return true;
	return (
		Object.entries(ACCOUNT_VERSION_WHEN_RATE_TYPE) as [
			AccountVersionConditional,
			string,
		][]
	).some(
		([column, rateType]) =>
			after.exchangeRateType === rateType &&
			!CONDITIONAL_SAME[column](before, after),
	);
}

/** `after` with the version the trigger would give it. */
export const withLocalVersion = (
	before: AccountRow,
	after: AccountRow,
): AccountRow =>
	movesVersion(before, after)
		? { ...after, version: before.version + 1 }
		: { ...after, version: before.version };

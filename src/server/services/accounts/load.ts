/**
 * Loads what the account figures read: every account of the user (closed
 * ones keep their past), its balance updates, legs and rate type switches,
 * Not tracked per currency, and one rate lookup for all their currencies.
 * Reads only through the given client, so a preview sees its own rows. The
 * rows go to accountsLedgerFromRows in @retrospend/domain, the same builder
 * a device loader uses.
 */
import {
	type AccountRow,
	type AccountsLedger,
	accountsLedgerFromRows,
	type LegRow,
} from "@retrospend/domain/accounts/account-figures";
import type { Prisma } from "~prisma";
import { homeCurrencyOf, ratePickFor } from "./ledger";

type Db = Prisma.TransactionClient;

export type { AccountsLedger };

const LEG_SELECT = {
	id: true,
	accountId: true,
	currency: true,
	date: true,
	createdAt: true,
	amount: true,
	source: true,
	homeAmount: true,
	homeCurrency: true,
} as const satisfies Prisma.AccountLegSelect;

const ACCOUNT_ROW_SELECT = {
	id: true,
	type: true,
	currency: true,
	balance: true,
	exchangeRate: true,
	exchangeRateType: true,
	closedAt: true,
	createdAt: true,
} as const satisfies Prisma.AssetAccountSelect;

type AccountSqlRow = Prisma.AssetAccountGetPayload<{
	select: typeof ACCOUNT_ROW_SELECT;
}>;

export const accountRowOf = (a: AccountSqlRow): AccountRow => ({
	id: a.id,
	type: a.type,
	currency: a.currency,
	balance: a.balance.toString(),
	exchangeRate: a.exchangeRate === null ? null : a.exchangeRate.toString(),
	exchangeRateType: a.exchangeRateType,
	closedAt: a.closedAt,
	createdAt: a.createdAt,
});

/** Every account of the user as the figures read it. */
export async function loadAccountRows(
	db: Db,
	userId: string,
	where: Prisma.AssetAccountWhereInput = {},
): Promise<AccountRow[]> {
	const accounts = await db.assetAccount.findMany({
		where: { userId, ...where },
		select: ACCOUNT_ROW_SELECT,
	});
	return accounts.map(accountRowOf);
}

export async function loadAccountsLedger(
	db: Db,
	userId: string,
): Promise<AccountsLedger> {
	const homeCurrency = await homeCurrencyOf(db, userId);
	const accounts = await loadAccountRows(db, userId);
	const snapshots = await db.assetSnapshot.findMany({
		where: { userId },
		select: {
			accountId: true,
			date: true,
			recordedAt: true,
			balance: true,
			currency: true,
			exchangeRateType: true,
		},
	});
	const legs = await db.accountLeg.findMany({
		where: { userId },
		select: LEG_SELECT,
	});
	const rateSwitches = await db.assetRateType.findMany({
		where: { userId },
		select: {
			accountId: true,
			from: true,
			type: true,
			previousType: true,
			createdAt: true,
		},
	});
	const untracked = new Set(
		legs.filter((l) => l.accountId === null).map((l) => l.currency),
	);
	const pick = await ratePickFor(db, [
		homeCurrency,
		...accounts.map((a) => a.currency),
		...snapshots.flatMap((s) => (s.currency ? [s.currency] : [])),
		...untracked,
	]);
	return accountsLedgerFromRows({
		home: homeCurrency,
		accounts,
		snapshots: snapshots.map((s) => ({ ...s, balance: s.balance.toString() })),
		legs: legs.map(
			(l): LegRow => ({
				...l,
				amount: l.amount.toString(),
				homeAmount: l.homeAmount === null ? null : l.homeAmount.toString(),
			}),
		),
		rateSwitches,
		pick,
	});
}

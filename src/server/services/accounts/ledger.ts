/**
 * Writes legs (MONEY-MOVES §2.1, I12): every money move that names a place
 * writes one leg per place, and an account's stored balance moves with its
 * leg in the same transaction. Everything goes through the caller's `tx`, so
 * a preview rolls it back.
 *
 * `asset_account.balance` stays the current balance every Wealth reader
 * already uses; legs explain how it got there (accounts/series.ts).
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { TRPCError } from "@trpc/server";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import { dec } from "~/server/services/envelope/units";
import type { AccountLegSource, AssetType, Prisma } from "~prisma";
import { balanceEffect } from "./places";
import { homeValue, type RatePick } from "./valuation";

type Tx = Prisma.TransactionClient;

/** The account columns a money move reads. */
export const ACCOUNT_SELECT = {
	id: true,
	name: true,
	type: true,
	currency: true,
	balance: true,
	exchangeRate: true,
	exchangeRateType: true,
	inBudget: true,
	countedUnits: true,
	closedAt: true,
} as const satisfies Prisma.AssetAccountSelect;

export type AccountRow = Prisma.AssetAccountGetPayload<{
	select: typeof ACCOUNT_SELECT;
}>;

/** One account's balance before and after a move, in its own currency. */
export interface AccountChange {
	readonly accountId: string;
	readonly name: string;
	readonly currency: string;
	readonly before: string;
	readonly after: string;
}

export interface LegInput {
	/** Null = Not tracked (N75). */
	readonly account: AccountRow | null;
	readonly currency: string;
	/** Signed in what you have, in `currency` (the account's when there is one). */
	readonly amount: Decimal;
	readonly date: Date;
	readonly source: AccountLegSource;
	readonly transferId?: string;
	readonly expenseId?: string;
	/** Booked home value (I20); null when no rate exists to book it. */
	readonly home: { readonly amount: Decimal; readonly currency: string } | null;
}

/**
 * An open account of the user, locked for the rest of the transaction so two
 * moves on it never interleave their balance changes.
 */
export async function lockOpenAccount(
	tx: Tx,
	userId: string,
	accountId: string,
): Promise<AccountRow> {
	await tx.$executeRaw`SELECT 1 FROM "asset_account" WHERE "id" = ${accountId} FOR UPDATE`;
	const account = await tx.assetAccount.findFirst({
		where: { id: accountId, userId },
		select: ACCOUNT_SELECT,
	});
	if (!account) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
	}
	if (account.closedAt) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This account is closed. Reopen it to change it.",
		});
	}
	return account;
}

export async function homeCurrencyOf(tx: Tx, userId: string): Promise<string> {
	const user = await tx.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true },
	});
	return user?.homeCurrency ?? "USD";
}

/** A rate lookup for these currencies (one query each, picks in memory). */
export async function ratePickFor(
	tx: Tx,
	currencies: Iterable<string>,
): Promise<RatePick> {
	return findExchangeRatesForDates(tx, currencies);
}

/** The fields that value an account (its currency, rate type and stored rate). */
export interface Valuable {
	readonly currency: string;
	readonly exchangeRateType: string | null;
	readonly exchangeRate: { toString(): string } | number | null;
}

/** What `amount` of a place is worth at home on `date`: an account at its own rate type, Not tracked at the default pick. */
export function bookHome(
	pick: RatePick,
	place: { currency: string; account: Valuable | null },
	amount: Decimal,
	homeCurrency: string,
	date: Date,
): { amount: Decimal; currency: string } | null {
	const valued = place.account
		? {
				currency: place.account.currency,
				rateType: place.account.exchangeRateType,
				storedRate: place.account.exchangeRate,
			}
		: { currency: place.currency, rateType: null, storedRate: null };
	const value = homeValue(pick, valued, amount, homeCurrency, endOfDayOf(date));
	return value && { amount: value.toDecimalPlaces(8), currency: homeCurrency };
}

const endOfDayOf = (date: Date) =>
	new Date(`${date.toISOString().slice(0, 10)}T23:59:59.999Z`);

/** Writes one leg and moves its account's stored balance by it. Returns the account's change. */
export async function writeLeg(
	tx: Tx,
	userId: string,
	leg: LegInput,
): Promise<AccountChange | null> {
	const { account } = leg;
	if (account && account.currency !== leg.currency) {
		throw new Error(
			`leg in ${leg.currency} on account ${account.id} in ${account.currency}`,
		);
	}
	await tx.accountLeg.create({
		data: {
			userId,
			accountId: account?.id ?? null,
			currency: leg.currency,
			amount: leg.amount.toString(),
			homeAmount: leg.home?.amount.toString() ?? null,
			homeCurrency: leg.home?.currency ?? null,
			date: leg.date,
			source: leg.source,
			transferId: leg.transferId ?? null,
			expenseId: leg.expenseId ?? null,
			// The app clock, like asset_snapshot.recordedAt, so the two order the same way.
			createdAt: new Date(),
		},
	});
	if (!account) return null;
	return moveBalance(tx, account, balanceEffect(account.type, leg.amount));
}

async function moveBalance(
	tx: Tx,
	account: Pick<AccountRow, "id" | "name" | "currency">,
	by: Decimal,
): Promise<AccountChange> {
	const updated = await tx.assetAccount.update({
		where: { id: account.id },
		data: { balance: { increment: by.toString() } },
		select: { balance: true },
	});
	const after = dec(updated.balance.toString());
	return {
		accountId: account.id,
		name: account.name,
		currency: account.currency,
		before: after.sub(by).toString(),
		after: after.toString(),
	};
}

/**
 * Takes back every leg `where` names (a transfer's or an income's), moving
 * each account back, then deletes the legs. Used by deletes and undos.
 */
export async function reverseLegs(
	tx: Tx,
	where: { transferId: string } | { expenseId: string },
): Promise<AccountChange[]> {
	const legs = await tx.accountLeg.findMany({
		where,
		select: {
			id: true,
			amount: true,
			accountId: true,
			account: { select: { id: true, name: true, currency: true, type: true } },
		},
	});
	const changes: AccountChange[] = [];
	for (const leg of legs) {
		if (leg.account) {
			await tx.$executeRaw`SELECT 1 FROM "asset_account" WHERE "id" = ${leg.account.id} FOR UPDATE`;
			const by = balanceEffect(
				leg.account.type as AssetType,
				dec(leg.amount.toString()),
			).neg();
			changes.push(await moveBalance(tx, leg.account, by));
		}
	}
	await tx.accountLeg.deleteMany({
		where: { id: { in: legs.map((l) => l.id) } },
	});
	return changes;
}

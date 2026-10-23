/**
 * Places money sits in (MONEY-MOVES §0, owner N75): an account, or Not
 * tracked (no account picked) per currency. Pure rules, no I/O.
 *
 * Legs are signed in what you have: +100 is 100 more money. A liability
 * stores what you owe as a positive balance, so a leg moves it the other
 * way: paying 100 into a card lowers its balance by 100.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import type { AssetType } from "~prisma";

export const isLiability = (type: AssetType) => type.startsWith("LIABILITY_");

/** How a leg of `worth` changes the stored balance of an account of `type`. */
export function balanceEffect(type: AssetType, worth: Decimal): Decimal {
	return isLiability(type) ? worth.neg() : worth;
}

/** What a stored balance is worth to you: owed money counts against you. */
export function worthOf(type: AssetType, balance: Decimal): Decimal {
	return isLiability(type) ? balance.neg() : balance;
}

interface BudgetFacts {
	readonly type: AssetType;
	readonly currency: string;
	readonly inBudget: boolean | null;
}

/**
 * "Part of my budget" defaults (MONEY-MOVES §2.1): cash and bank accounts and
 * credit cards in the home currency are in; foreign money, investments,
 * crypto, property and loans are out.
 */
export function defaultInBudget(
	account: Omit<BudgetFacts, "inBudget">,
	homeCurrency: string,
): boolean {
	if (account.currency !== homeCurrency) return false;
	return account.type === "CASH" || account.type === "LIABILITY_CREDIT_CARD";
}

export function inBudget(account: BudgetFacts, homeCurrency: string): boolean {
	return account.inBudget ?? defaultInBudget(account, homeCurrency);
}

/** Not tracked is in the budget in the home currency only (§2.1). */
export function placeInBudget(
	account: BudgetFacts | null,
	currency: string,
	homeCurrency: string,
): boolean {
	return account ? inBudget(account, homeCurrency) : currency === homeCurrency;
}

/**
 * Income the budget counts (not kept in Wealth) that lands in an account
 * outside the budget (D4): its units are counted there, so moving them into
 * the budget later never counts them a second time. A liability holds no
 * units of yours to count.
 */
export function countedOnArrival(
	account: BudgetFacts,
	kept: boolean,
	homeCurrency: string,
): boolean {
	return (
		!kept && !inBudget(account, homeCurrency) && !isLiability(account.type)
	);
}

/**
 * Counted units after a balance is set by hand (D4): never more than the
 * account holds, none on a liability. The account_leg trigger applies the
 * same cap after every leg.
 */
export function cappedCounted(
	type: AssetType,
	counted: Decimal,
	balance: Decimal,
): Decimal {
	if (isLiability(type) || !balance.gt(0)) return balance.mul(0);
	return counted.lt(balance) ? counted : balance;
}

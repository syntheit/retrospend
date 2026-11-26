/**
 * The rules of a move between your own places (MONEY-MOVES §2.3 to §2.7,
 * README D4). Pure: the mutation loads the places and books the legs.
 *
 * - Kind: two currencies is an Exchange; a card destination is a Card
 *   payment, a loan or mortgage a Debt payment; cash out of an account is a
 *   Withdrawal when asked for.
 * - Typed amounts win (I21): both amounts are stored as typed; the rate is
 *   derived from them.
 * - The budget moves only when the move crosses its line (I14, I15), by the
 *   in-budget leg as typed. Money a Move in already counted (D4) leaves first
 *   and never enters the budget again; it follows the money to another place
 *   outside the budget.
 */

import {
	type AssetType,
	cappedCounted,
	placeInBudget,
} from "../accounts/places";
import { dec, toMinor } from "../envelope/units";
import { currencyDecimals } from "../money";
import { roundRateDec } from "../money-dec";
import type { Decimal } from "../precise-decimal";
import { TransferRefusal } from "./refusals";

/** Mirrors the TransferKind enum of the database (prisma/schema.prisma). */
export type TransferKind =
	| "TRANSFER"
	| "EXCHANGE"
	| "CARD_PAYMENT"
	| "WITHDRAWAL"
	| "DEBT_PAYMENT";

export interface PlaceFacts {
	readonly id: string;
	readonly type: AssetType;
	readonly currency: string;
	readonly inBudget: boolean | null;
	readonly countedUnits: Decimal;
}

export interface TransferPlanInput {
	readonly from: PlaceFacts | null;
	readonly to: PlaceFacts | null;
	readonly fromCurrency: string;
	readonly toCurrency: string;
	readonly fromAmount: Decimal;
	readonly toAmount: Decimal;
	readonly requestedKind?: TransferKind | null;
	readonly homeCurrency: string;
}

export type BudgetEffect =
	| { readonly effect: "none" }
	/** Leaves the budget: an envelope (or To assign) gives up the in-budget leg. */
	| {
			readonly effect: "leaves";
			readonly minor: number;
			readonly currency: string;
	  }
	/** Enters the budget: the fresh part of the in-budget leg; counted units never enter twice. */
	| {
			readonly effect: "enters";
			readonly minor: number;
			readonly currency: string;
	  }
	/** Out of Wealth, but all of it was counted by a Move in already. */
	| { readonly effect: "counted" }
	/** It crosses the budget's line, but no rate values the in-budget leg (R14). */
	| { readonly effect: "unavailable" };

export interface TransferPlan {
	readonly kind: TransferKind;
	/** Counted units the source gives up, and the destination gets (D4). */
	readonly countedFromUnits: Decimal;
	readonly countedToUnits: Decimal;
	/** Share of the source amount that was not counted before. */
	readonly freshUnits: Decimal;
}

const bad = (message: string) => new TransferRefusal(message);

const isCard = (p: PlaceFacts | null) => p?.type === "LIABILITY_CREDIT_CARD";
const isLoan = (p: PlaceFacts | null) =>
	p?.type === "LIABILITY_LOAN" || p?.type === "LIABILITY_MORTGAGE";

export function resolveKind(input: TransferPlanInput): TransferKind {
	const { from, to, requestedKind } = input;
	if (!from && !to) throw bad("Pick at least one account");
	if (from && to && from.id === to.id) throw bad("Pick two different places");
	if (input.fromCurrency !== input.toCurrency) {
		if (requestedKind && requestedKind !== "EXCHANGE") {
			throw bad("Two currencies make this an exchange");
		}
		return "EXCHANGE";
	}
	switch (requestedKind) {
		case "EXCHANGE":
			throw bad("An exchange needs two currencies");
		case "CARD_PAYMENT":
			if (!isCard(to)) throw bad("A card payment goes to a credit card");
			return "CARD_PAYMENT";
		case "DEBT_PAYMENT":
			if (!isLoan(to)) throw bad("A debt payment goes to a loan or mortgage");
			return "DEBT_PAYMENT";
		case "WITHDRAWAL":
			if (!from || (to && to.type !== "CASH")) {
				throw bad("A withdrawal takes cash out of an account");
			}
			return "WITHDRAWAL";
		case "TRANSFER":
			return "TRANSFER";
		default:
			if (isCard(to)) return "CARD_PAYMENT";
			if (isLoan(to)) return "DEBT_PAYMENT";
			return "TRANSFER";
	}
}

const sourceInBudget = (input: TransferPlanInput) =>
	placeInBudget(input.from, input.fromCurrency, input.homeCurrency);
const destinationInBudget = (input: TransferPlanInput) =>
	placeInBudget(input.to, input.toCurrency, input.homeCurrency);

export function planTransfer(input: TransferPlanInput): TransferPlan {
	if (!input.fromAmount.gt(0) || !input.toAmount.gt(0)) {
		throw bad("Enter an amount above zero");
	}
	const kind = resolveKind(input);
	if (kind !== "EXCHANGE" && !input.fromAmount.eq(input.toAmount)) {
		throw bad("A move in one currency has one amount");
	}
	const fromIn = sourceInBudget(input);
	const toIn = destinationInBudget(input);
	const counted =
		input.from && !fromIn
			? units8(
					cappedCounted(
						input.from.type,
						input.from.countedUnits,
						input.fromAmount,
					),
				)
			: dec(0);
	const countedTo =
		counted.gt(0) && input.to && !toIn
			? units8(input.toAmount.mul(counted).div(input.fromAmount))
			: dec(0);
	return {
		kind,
		countedFromUnits: counted,
		countedToUnits: countedTo,
		freshUnits: input.fromAmount.sub(counted),
	};
}

/** Units are kept at the 8 decimals the columns hold, half to even. */
const units8 = (d: Decimal) => roundRateDec(d, 8);

/**
 * The budget's half (I14, I15): the in-budget leg's booked home value when
 * the move crosses the line, the fresh part only when it enters. A booked
 * side is null when no rate values it: the effect is then unavailable,
 * never none.
 */
export function budgetEffect(
	input: TransferPlanInput,
	plan: TransferPlan,
	booked: {
		readonly fromHome: Decimal | null;
		readonly toHome: Decimal | null;
	},
): BudgetEffect {
	const fromIn = sourceInBudget(input);
	const toIn = destinationInBudget(input);
	const home = input.homeCurrency;
	if (fromIn === toIn) return { effect: "none" };
	if (fromIn) {
		if (!booked.fromHome) return { effect: "unavailable" };
		return {
			effect: "leaves",
			minor: toMinor(booked.fromHome.abs(), home),
			currency: home,
		};
	}
	if (plan.freshUnits.isZero()) return { effect: "counted" };
	if (!booked.toHome) return { effect: "unavailable" };
	const fresh = booked.toHome.abs().mul(plan.freshUnits).div(input.fromAmount);
	return { effect: "enters", minor: toMinor(fresh, home), currency: home };
}

/**
 * The rate the typed amounts imply (I21): home per foreign unit when one side
 * is home, else destination per source unit. Six decimals.
 */
export function derivedRate(
	input: Pick<
		TransferPlanInput,
		"fromAmount" | "toAmount" | "fromCurrency" | "toCurrency" | "homeCurrency"
	>,
): {
	readonly base: string;
	readonly quote: string;
	readonly value: string;
} | null {
	if (input.fromCurrency === input.toCurrency) return null;
	const homeIsFrom = input.fromCurrency === input.homeCurrency;
	const [base, quote, value] = homeIsFrom
		? [
				input.toCurrency,
				input.fromCurrency,
				input.fromAmount.div(input.toAmount),
			]
		: [
				input.fromCurrency,
				input.toCurrency,
				input.toAmount.div(input.fromAmount),
			];
	return { base, quote, value: roundRateDec(value, 6).toFixed(6) };
}

/** An amount the user typed, checked against its currency's minor units. */
export function typedAmount(text: string, currency: string): Decimal {
	let value: Decimal;
	try {
		value = dec(text);
	} catch {
		throw bad("Enter a valid amount");
	}
	if (value.decimalPlaces() > currencyDecimals(currency)) {
		throw bad(`${currency} has ${currencyDecimals(currency)} decimals`);
	}
	return value;
}

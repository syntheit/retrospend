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
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "@retrospend/domain/money";
import { dec, toMinor } from "~/server/services/envelope/units";
import type { AssetType, TransferKind } from "~prisma";
import { placeInBudget } from "../accounts/places";

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

const bad = (message: string) =>
	new TRPCError({ code: "BAD_REQUEST", message });

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

const inBudgetOf = (input: TransferPlanInput, side: "from" | "to") =>
	placeInBudget(
		input[side],
		side === "from" ? input.fromCurrency : input.toCurrency,
		input.homeCurrency,
	);

export function planTransfer(input: TransferPlanInput): TransferPlan {
	if (!input.fromAmount.gt(0) || !input.toAmount.gt(0)) {
		throw bad("Enter an amount above zero");
	}
	const kind = resolveKind(input);
	if (kind !== "EXCHANGE" && !input.fromAmount.eq(input.toAmount)) {
		throw bad("A move in one currency has one amount");
	}
	const fromIn = inBudgetOf(input, "from");
	const toIn = inBudgetOf(input, "to");
	const counted =
		input.from && !fromIn
			? Decimal8(minDec(input.from.countedUnits, input.fromAmount))
			: dec(0);
	const countedTo =
		counted.gt(0) && input.to && !toIn
			? Decimal8(input.toAmount.mul(counted).div(input.fromAmount))
			: dec(0);
	return {
		kind,
		countedFromUnits: counted,
		countedToUnits: countedTo,
		freshUnits: input.fromAmount.sub(counted),
	};
}

const minDec = (a: Decimal, b: Decimal) => (a.lt(b) ? a : b);
const Decimal8 = (d: Decimal) => d.toDecimalPlaces(8);

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
	const fromIn = inBudgetOf(input, "from");
	const toIn = inBudgetOf(input, "to");
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
	return { base, quote, value: value.toFixed(6) };
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

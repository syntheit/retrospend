/**
 * Everything a transfer writes, as plain values: the Transfer row, one leg
 * per place, the optional fee (its expense row and FEE leg), the counted
 * units that move, and what the budget's side must do. Pure: the caller
 * loads the places and rates, writes the rows, and runs the budget's side.
 * The server (services/transfers/create.mutation.ts) and the device engine
 * call this one copy, so a move books the same legs on both.
 *
 * Leg amounts are signed in what you have; the account_leg trigger (or
 * `applyLegs` on the device) moves balances, snapshots and counted units.
 * Home values are booked by `bookHome`, 8 decimals half to even; a side with
 * no rate books no home value (null), and a missing rate for the arrival of
 * an exchange is refused, never taken as 1.
 */
import { bookHome, type Valuable } from "../accounts/book-home";
import type { AssetType } from "../accounts/places";
import {
	byFraction,
	homePerUnit,
	homeValue,
	type RatePick,
	ratePerUnit,
} from "../accounts/valuation";
import { dec, toMinor } from "../envelope/units";
import { roundMoneyDec, roundRateDec } from "../money-dec";
import type { Decimal } from "../precise-decimal";
import { CURRENCY_KEY } from "../rate-booking";
import { rowDateOf } from "../time-zone";
import {
	type BudgetEffect,
	budgetEffect,
	derivedRate,
	type PlaceFacts,
	planTransfer,
	type TransferKind,
	type TransferPlanInput,
	typedAmount,
} from "./plan";
import { NoArrivalRateError, TransferRefusal } from "./refusals";

/** The expense row of a transfer's fee: one text, sealed with the rest of the user's text. */
export const TRANSFER_FEE_TEXT = {
	title: "Fee",
	description: "Fee for a transfer",
} as const;

/** The account facts a transfer reads (an `asset_account` row). */
export interface TransferAccount extends Valuable {
	readonly id: string;
	readonly type: AssetType;
	readonly inBudget: boolean | null;
	/** Units of the balance the budget already counts. */
	readonly countedUnits: { toString(): string };
}

/** One end of a move: an account, or Not tracked (no account) in `currency`. */
export interface TransferSide {
	readonly account: TransferAccount | null;
	/** Needed when the account is null; an account's own currency wins. */
	readonly currency?: string | null;
}

export interface TransferRowsInput {
	readonly from: TransferSide;
	readonly to: TransferSide;
	/** Typed text, checked against its currency's minor units. */
	readonly fromAmount: string;
	/** Exchange: what arrived, as typed. Omitted: at the reference rate. */
	readonly toAmount?: string | null;
	readonly kind?: TransferKind | null;
	readonly pick: RatePick;
	readonly homeCurrency: string;
	/** The day of the move as a UTC midnight, never in the future (the caller's rule). */
	readonly date: Date;
	/** The viewer's zone: the fee's expense row sits at that zone's midnight. */
	readonly timeZone?: string;
	readonly note?: string | null;
	/** A bank fee booked as its own expense; no account means the source side. */
	readonly fee?: {
		readonly amount: string;
		readonly account?: TransferAccount | null;
	} | null;
	/**
	 * Client-generated ids for every row the move creates: the fee's expense
	 * and FEE leg are used only when a fee is booked.
	 */
	readonly ids: TransferRowIds;
}

export interface TransferRowIds {
	readonly transfer: string;
	/** The source side's TRANSFER leg, then the destination's. */
	readonly fromLeg: string;
	readonly toLeg: string;
	readonly feeExpense: string;
	readonly feeLeg: string;
}

export interface TransferRowValues {
	readonly id: string;
	readonly kind: TransferKind;
	readonly date: Date;
	readonly fromAccountId: string | null;
	readonly fromAmount: string;
	readonly fromCurrency: string;
	readonly toAccountId: string | null;
	readonly toAmount: string;
	readonly toCurrency: string;
	readonly referenceRateType: string | null;
	readonly countedFromUnits: string;
	readonly countedToUnits: string;
	readonly note: string | null;
}

export interface TransferLegRow {
	readonly id: string;
	/** Null is Not tracked: the leg moves nothing. */
	readonly accountId: string | null;
	readonly currency: string;
	/** Signed in what you have, in `currency`. */
	readonly amount: Decimal;
	readonly date: Date;
	readonly source: "TRANSFER" | "FEE";
	readonly transferId: string;
	readonly expenseId: string | null;
	/** Booked home value (I20); null when no rate exists to book it. */
	readonly home: { readonly amount: Decimal; readonly currency: string } | null;
}

export interface TransferFeeRows {
	/** The values of the OUT expense (createExpenseIn). */
	readonly expense: {
		readonly id: string;
		readonly title: string;
		readonly amount: string;
		readonly currency: string;
		readonly date: Date;
		readonly description: string;
	};
	readonly leg: TransferLegRow;
}

/** Counted units that leave the source and follow the money (D4), before the legs' cap. */
export interface CountedMove {
	readonly accountId: string;
	/** Negative: the source gives up; positive: the destination takes. */
	readonly delta: Decimal;
}

export interface TransferReference {
	/** The typed home leg against the reference rate: negative = you got less than the reference. */
	readonly vsReference: { minor: number; currency: string } | null;
	readonly referenceRateType: string | null;
	/** The reference rate itself (home per unit), for "Official 1,450". */
	readonly referenceRate: ReturnType<typeof derivedRate>;
}

export interface TransferRows {
	readonly transfer: TransferRowValues;
	/** The source's leg, then the destination's. */
	readonly legs: readonly [TransferLegRow, TransferLegRow];
	/** Written after the legs; the device sets the transfer's feeExpenseId to its id. */
	readonly fee: TransferFeeRows | null;
	readonly countedMoves: readonly CountedMove[];
	readonly rate: ReturnType<typeof derivedRate>;
	readonly reference: TransferReference;
	/** What the legs did to net worth, fee included; null when a leg has no rate. */
	readonly netWorthEffect: { minor: number; currency: string } | null;
	readonly budget: BudgetEffect;
	/** The account across the budget's line: where a Move in lands or the money came from. */
	readonly budgetAccountId: string | null;
}

interface Place {
	readonly account: TransferAccount | null;
	readonly currency: string;
}

/** The currency of a side: its account's, else the one given for Not tracked. */
export function sideCurrency(side: TransferSide): string {
	if (side.account) return side.account.currency;
	if (!side.currency || !CURRENCY_KEY.test(side.currency)) {
		throw new TransferRefusal(
			"Pick an account or the currency of the money that is not tracked",
		);
	}
	return side.currency;
}

const placeOf = (side: TransferSide): Place => ({
	account: side.account,
	currency: sideCurrency(side),
});

const placeFacts = (place: Place): PlaceFacts | null =>
	place.account && {
		id: place.account.id,
		type: place.account.type,
		currency: place.account.currency,
		inBudget: place.account.inBudget,
		countedUnits: dec(place.account.countedUnits.toString()),
	};

/** What arrives at the reference rate (the default pick of both currencies), rounded to the destination's minor unit. */
function atReference(
	pick: RatePick,
	amount: Decimal,
	from: string,
	to: string,
	date: Date,
): Decimal {
	const arrives = homeValue(
		pick,
		{ currency: from, rateType: null, storedRate: null },
		dec(amount),
		to,
		date,
	);
	if (!arrives) throw new NoArrivalRateError(from, to);
	return roundMoneyDec(arrives, to);
}

const NO_REFERENCE: TransferReference = {
	vsReference: null,
	referenceRateType: null,
	referenceRate: null,
};

function referenceOf(
	pick: RatePick,
	input: TransferPlanInput,
	booked: { fromHome: Decimal; toHome: Decimal },
	date: Date,
): TransferReference {
	const home = input.homeCurrency;
	const homeIsFrom = input.fromCurrency === home;
	if (
		input.fromCurrency === input.toCurrency ||
		(!homeIsFrom && input.toCurrency !== home)
	) {
		return NO_REFERENCE;
	}
	const foreign = homeIsFrom ? input.toCurrency : input.fromCurrency;
	const units = homeIsFrom ? input.toAmount : input.fromAmount.neg();
	const fraction = homePerUnit(
		pick,
		{ currency: foreign, rateType: null, storedRate: null },
		home,
		date,
	);
	if (!fraction) return NO_REFERENCE;
	const typedHome = homeIsFrom ? booked.fromHome : booked.toHome;
	const ref = pick(foreign === "USD" ? home : foreign, date, null);
	return {
		vsReference: {
			minor: toMinor(typedHome.add(byFraction(units, fraction)), home),
			currency: home,
		},
		referenceRateType: ref?.type ?? null,
		referenceRate: {
			base: foreign,
			quote: home,
			value: roundRateDec(ratePerUnit(fraction), 6).toFixed(6),
		},
	};
}

/** The fee's expense and FEE leg; none when the typed fee is zero. */
function feeRows(
	input: TransferRowsInput,
	source: Place,
	home: string,
): { rows: TransferFeeRows; home: Decimal | null } | null {
	if (!input.fee) return null;
	const place = input.fee.account
		? placeOf({ account: input.fee.account })
		: source;
	const amount = typedAmount(input.fee.amount, place.currency);
	if (!amount.gt(0)) return null;
	const booked = bookHome(input.pick, place, amount.neg(), home, input.date);
	return {
		rows: {
			expense: {
				id: input.ids.feeExpense,
				...TRANSFER_FEE_TEXT,
				amount: amount.toString(),
				currency: place.currency,
				// An expense row, read in the viewer's zone (rowDateOf).
				date: rowDateOf(input.date, input.timeZone),
			},
			leg: {
				id: input.ids.feeLeg,
				accountId: place.account?.id ?? null,
				currency: place.currency,
				amount: amount.neg(),
				date: input.date,
				source: "FEE",
				transferId: input.ids.transfer,
				expenseId: input.ids.feeExpense,
				home: booked,
			},
		},
		home: booked?.amount ?? null,
	};
}

/** D4: counted units leave the source first and follow the money to a place outside the budget. */
function countedMovesOf(
	from: Place,
	to: Place,
	plan: { countedFromUnits: Decimal; countedToUnits: Decimal },
): CountedMove[] {
	const moves: CountedMove[] = [];
	if (from.account && plan.countedFromUnits.gt(0)) {
		moves.push({
			accountId: from.account.id,
			delta: plan.countedFromUnits.neg(),
		});
	}
	if (to.account && plan.countedToUnits.gt(0)) {
		moves.push({ accountId: to.account.id, delta: plan.countedToUnits });
	}
	return moves;
}

export function transferRows(input: TransferRowsInput): TransferRows {
	const { pick, homeCurrency: home, date } = input;
	const from = placeOf(input.from);
	const to = placeOf(input.to);
	const fromAmount = typedAmount(input.fromAmount, from.currency);
	const toAmount =
		from.currency === to.currency
			? fromAmount
			: input.toAmount
				? typedAmount(input.toAmount, to.currency)
				: atReference(pick, fromAmount, from.currency, to.currency, date);
	const planInput: TransferPlanInput = {
		from: placeFacts(from),
		to: placeFacts(to),
		fromCurrency: from.currency,
		toCurrency: to.currency,
		fromAmount,
		toAmount,
		requestedKind: input.kind,
		homeCurrency: home,
	};
	const fromHome = bookHome(pick, from, fromAmount.neg(), home, date);
	const toHome = bookHome(pick, to, toAmount, home, date);
	const booked = fromHome &&
		toHome && { fromHome: fromHome.amount, toHome: toHome.amount };
	const plan = planTransfer(planInput);
	const reference = booked
		? referenceOf(pick, planInput, booked, date)
		: NO_REFERENCE;
	const fee = feeRows(input, from, home);
	const effect = budgetEffect(planInput, plan, {
		fromHome: fromHome?.amount ?? null,
		toHome: toHome?.amount ?? null,
	});
	// A fee with no home value leaves the effect unknown, never 0 (a missing
	// rate is never 1, and never a free fee).
	const feeHome = fee ? fee.home : dec(0);
	const netWorth =
		booked && feeHome ? booked.fromHome.add(booked.toHome).add(feeHome) : null;
	const leg = (
		id: string,
		place: Place,
		amount: Decimal,
		valued: typeof fromHome,
	): TransferLegRow => ({
		id,
		accountId: place.account?.id ?? null,
		currency: place.currency,
		amount,
		date,
		source: "TRANSFER",
		transferId: input.ids.transfer,
		expenseId: null,
		home: valued,
	});
	return {
		transfer: {
			id: input.ids.transfer,
			kind: plan.kind,
			date,
			fromAccountId: from.account?.id ?? null,
			fromAmount: fromAmount.toString(),
			fromCurrency: from.currency,
			toAccountId: to.account?.id ?? null,
			toAmount: toAmount.toString(),
			toCurrency: to.currency,
			referenceRateType: reference.referenceRateType,
			countedFromUnits: plan.countedFromUnits.toString(),
			countedToUnits: plan.countedToUnits.toString(),
			note: input.note ?? null,
		},
		legs: [
			leg(input.ids.fromLeg, from, fromAmount.neg(), fromHome),
			leg(input.ids.toLeg, to, toAmount, toHome),
		],
		fee: fee?.rows ?? null,
		countedMoves: countedMovesOf(from, to, plan),
		rate: derivedRate(planInput),
		reference,
		netWorthEffect: netWorth
			? { minor: toMinor(netWorth, home), currency: home }
			: null,
		budget: effect,
		budgetAccountId:
			(effect.effect === "leaves" ? to : from).account?.id ?? null,
	};
}

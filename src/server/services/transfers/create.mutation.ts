/**
 * transfer.create (MONEY-MOVES §2.3 to §2.7): one move between two of your
 * own places, as a Transfer and one leg per place. The Transfer and Exchange
 * sheet previews this same mutation (R30), so "What this changes" is what
 * Save writes. Kinds: TRANSFER, EXCHANGE, CARD_PAYMENT, WITHDRAWAL,
 * DEBT_PAYMENT. A null account is Not tracked (N75): the move still lands
 * there, so net worth never jumps.
 */
import { randomUUID } from "node:crypto";
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "~/lib/money";
import type { Money } from "~/server/figures/registry";
import { dec, toMinor } from "~/server/services/envelope/units";
import { createExpenseIn } from "~/server/services/expense.service";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma, TransferKind } from "~prisma";
import { moveDay } from "../accounts/dates";
import {
	type AccountChange,
	type AccountRow,
	bookHome,
	homeCurrencyOf,
	lockOpenAccount,
	ratePickFor,
	writeLeg,
} from "../accounts/ledger";
import { homePerUnit, type RatePick } from "../accounts/valuation";
import { type BudgetSideResult, recordBudgetSide } from "./budget-side";
import {
	type BudgetEffect,
	budgetEffect,
	derivedRate,
	planTransfer,
	type TransferPlanInput,
	typedAmount,
} from "./plan";

type Tx = Prisma.TransactionClient;

export const TRANSFER_FIGURES = [
	"netWorth",
	"accounts.balance",
	"notTracked",
	"netWorthChange.exchange",
	"spent",
];

export interface CreateTransferInput {
	/** Set only by the undo of a delete, to bring the same move back. */
	readonly id?: string;
	readonly fromAccountId: string | null;
	readonly toAccountId: string | null;
	/** Needed when that side is Not tracked; an account's own currency otherwise. */
	readonly fromCurrency?: string | null;
	readonly toCurrency?: string | null;
	readonly fromAmount: string;
	/** Exchange: what arrived, as typed. Omitted: at the reference rate. */
	readonly toAmount?: string | null;
	readonly kind?: TransferKind | null;
	/** YYYY-MM-DD; today when omitted. */
	readonly date?: string | null;
	readonly note?: string | null;
	/** A bank fee, recorded as its own expense from `accountId` (default: the source). */
	readonly fee?: {
		readonly amount: string;
		readonly accountId?: string | null;
	} | null;
	/** Leaving the budget: the envelope it comes from (null = To assign). */
	readonly envelopeId?: string | null;
	/** Entering the budget: the envelope it goes into (null = To assign). */
	readonly putIn?: string | null;
	readonly timeZone?: string;
}

export interface TransferValue {
	readonly transferId: string;
	readonly kind: TransferKind;
	readonly fromAmount: string;
	readonly fromCurrency: string;
	readonly toAmount: string;
	readonly toCurrency: string;
	readonly rate: ReturnType<typeof derivedRate>;
	/** The typed home leg against the reference rate: negative = you got less than the reference. */
	readonly vsReference: Money | null;
	readonly referenceRateType: string | null;
	readonly accounts: readonly AccountChange[];
	/** What the legs did to net worth: the exchange result, and the fee. */
	readonly netWorthEffect: Money | null;
	readonly budget: BudgetEffect & { readonly side: BudgetSideResult };
	readonly feeExpenseId: string | null;
}

interface Side {
	readonly account: AccountRow | null;
	readonly currency: string;
}

async function sideOf(
	tx: Tx,
	userId: string,
	accountId: string | null,
	currency: string | null | undefined,
): Promise<Side> {
	if (accountId) {
		const account = await lockOpenAccount(tx, userId, accountId);
		return { account, currency: account.currency };
	}
	if (!currency || !/^[A-Z0-9]{3,10}$/.test(currency)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Pick an account or the currency of the money that is not tracked",
		});
	}
	return { account: null, currency };
}

/** What arrives at the reference rate (the default pick of both currencies), rounded to the destination's minor unit. */
function atReference(
	pick: RatePick,
	amount: Decimal,
	from: string,
	to: string,
	date: Date,
): Decimal {
	const fromHome = homePerUnit(
		pick,
		{ currency: from, rateType: null, storedRate: null },
		to,
		date,
	);
	if (!fromHome) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `No exchange rate for ${from} to ${to}. Type what arrived.`,
		});
	}
	return amount.mul(fromHome).toDecimalPlaces(currencyDecimals(to));
}

const placeFacts = (side: Side) =>
	side.account && {
		id: side.account.id,
		type: side.account.type,
		currency: side.account.currency,
		inBudget: side.account.inBudget,
		countedUnits: dec(side.account.countedUnits.toString()),
	};

function reference(
	pick: RatePick,
	input: TransferPlanInput,
	booked: { fromHome: Decimal; toHome: Decimal },
	date: Date,
) {
	const home = input.homeCurrency;
	const homeIsFrom = input.fromCurrency === home;
	if (
		input.fromCurrency === input.toCurrency ||
		(!homeIsFrom && input.toCurrency !== home)
	) {
		return { vsReference: null, referenceRateType: null };
	}
	const foreign = homeIsFrom ? input.toCurrency : input.fromCurrency;
	const units = homeIsFrom ? input.toAmount : input.fromAmount.neg();
	const perUnit = homePerUnit(
		pick,
		{ currency: foreign, rateType: null, storedRate: null },
		home,
		date,
	);
	if (!perUnit) return { vsReference: null, referenceRateType: null };
	const typedHome = homeIsFrom ? booked.fromHome : booked.toHome;
	const ref = pick(foreign === "USD" ? home : foreign, date, null);
	return {
		vsReference: {
			minor: toMinor(typedHome.add(units.mul(perUnit)), home),
			currency: home,
		},
		referenceRateType: ref?.type ?? null,
	};
}

async function writeFee(
	tx: Tx,
	userId: string,
	input: CreateTransferInput,
	ctx: {
		transferId: string;
		from: Side;
		date: Date;
		home: string;
		pick: RatePick;
	},
): Promise<{
	expenseId: string;
	change: AccountChange | null;
	home: Decimal | null;
} | null> {
	if (!input.fee) return null;
	const side = input.fee.accountId
		? await sideOf(tx, userId, input.fee.accountId, null)
		: ctx.from;
	const amount = typedAmount(input.fee.amount, side.currency);
	if (!amount.gt(0)) return null;
	const expense = await createExpenseIn(tx, userId, {
		id: randomUUID(),
		title: "Fee",
		amount: amount.toNumber(),
		currency: side.currency,
		date: ctx.date,
		description: "Fee for a transfer",
	});
	const home = bookHome(ctx.pick, side, amount.neg(), ctx.home, ctx.date);
	const change = await writeLeg(tx, userId, {
		...side,
		amount: amount.neg(),
		date: ctx.date,
		source: "FEE",
		transferId: ctx.transferId,
		expenseId: expense.id,
		home,
	});
	return { expenseId: expense.id, change, home: home?.amount ?? null };
}

/** Everything a move needs before it writes: its places, amounts, plan and booked legs. */
async function resolveMove(tx: Tx, userId: string, input: CreateTransferInput) {
	const date = moveDay(input.date, new Date(), input.timeZone);
	const home = await homeCurrencyOf(tx, userId);
	const from = await sideOf(
		tx,
		userId,
		input.fromAccountId,
		input.fromCurrency,
	);
	const to = await sideOf(tx, userId, input.toAccountId, input.toCurrency);
	const pick = await ratePickFor(tx, [home, from.currency, to.currency]);
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
	return {
		date,
		home,
		from,
		to,
		pick,
		planInput,
		plan: planTransfer(planInput),
		legs: [
			[from, fromAmount.neg(), fromHome],
			[to, toAmount, toHome],
		] as const,
		booked,
		ref: booked
			? reference(pick, planInput, booked, date)
			: { vsReference: null, referenceRateType: null },
	};
}

type Move = Awaited<ReturnType<typeof resolveMove>>;

/** Writes the Transfer, its two legs and the counted units it moves (D4). */
async function writeMove(
	tx: Tx,
	userId: string,
	move: Move,
	input: CreateTransferInput,
): Promise<{ transferId: string; changes: AccountChange[] }> {
	const { planInput, plan, date } = move;
	const transferId = input.id ?? randomUUID();
	await tx.transfer.create({
		data: {
			id: transferId,
			userId,
			kind: plan.kind,
			date,
			fromAccountId: move.from.account?.id ?? null,
			fromAmount: planInput.fromAmount.toString(),
			fromCurrency: planInput.fromCurrency,
			toAccountId: move.to.account?.id ?? null,
			toAmount: planInput.toAmount.toString(),
			toCurrency: planInput.toCurrency,
			referenceRateType: move.ref.referenceRateType,
			countedFromUnits: plan.countedFromUnits.toString(),
			countedToUnits: plan.countedToUnits.toString(),
			note: input.note ?? null,
		},
	});
	const changes: AccountChange[] = [];
	for (const [side, amount, home] of move.legs) {
		const change = await writeLeg(tx, userId, {
			...side,
			amount,
			date,
			source: "TRANSFER",
			transferId,
			home,
		});
		if (change) changes.push(change);
	}
	await moveCounted(tx, move.from, move.to, plan);
	return { transferId, changes };
}

export async function createTransferIn(
	tx: Tx,
	userId: string,
	input: CreateTransferInput,
): Promise<TransferValue> {
	const move = await resolveMove(tx, userId, input);
	const { transferId, changes } = await writeMove(tx, userId, move, input);
	const fee = await writeFee(tx, userId, input, { ...move, transferId });
	if (fee) {
		await tx.transfer.update({
			where: { id: transferId },
			data: { feeExpenseId: fee.expenseId },
		});
		if (fee.change) changes.push(fee.change);
	}
	const effect: BudgetEffect = move.booked
		? budgetEffect(move.planInput, move.plan, move.booked)
		: { effect: "none" };
	const leaves = effect.effect === "leaves";
	const side = await budgetSideOf(tx, userId, effect, {
		transferId,
		date: move.date,
		envelopeId: (leaves ? input.envelopeId : input.putIn) ?? null,
		accountId: (leaves ? move.to : move.from).account?.id ?? null,
	});
	const netWorth = move.booked?.fromHome
		.add(move.booked.toHome)
		.add(fee?.home ?? dec(0));
	return {
		transferId,
		kind: move.plan.kind,
		fromAmount: move.planInput.fromAmount.toString(),
		fromCurrency: move.planInput.fromCurrency,
		toAmount: move.planInput.toAmount.toString(),
		toCurrency: move.planInput.toCurrency,
		rate: derivedRate(move.planInput),
		...move.ref,
		accounts: changes,
		netWorthEffect: netWorth
			? { minor: toMinor(netWorth, move.home), currency: move.home }
			: null,
		budget: { ...effect, side },
		feeExpenseId: fee?.expenseId ?? null,
	};
}

/** D4: counted units leave the source first and follow the money to a place outside the budget. */
async function moveCounted(
	tx: Tx,
	from: Side,
	to: Side,
	plan: { countedFromUnits: Decimal; countedToUnits: Decimal },
) {
	if (from.account && plan.countedFromUnits.gt(0)) {
		await tx.assetAccount.update({
			where: { id: from.account.id },
			data: { countedUnits: { decrement: plan.countedFromUnits.toString() } },
		});
	}
	if (to.account && plan.countedToUnits.gt(0)) {
		await tx.assetAccount.update({
			where: { id: to.account.id },
			data: { countedUnits: { increment: plan.countedToUnits.toString() } },
		});
	}
}

async function budgetSideOf(
	tx: Tx,
	userId: string,
	effect: BudgetEffect,
	ctx: {
		transferId: string;
		date: Date;
		envelopeId: string | null;
		accountId: string | null;
	},
): Promise<BudgetSideResult> {
	if (effect.effect !== "leaves" && effect.effect !== "enters") {
		return { recorded: false, reason: null };
	}
	return recordBudgetSide(tx, {
		userId,
		direction: effect.effect === "leaves" ? "TO_WEALTH" : "FROM_WEALTH",
		amount: { minor: effect.minor, currency: effect.currency },
		envelopeId: ctx.envelopeId,
		date: ctx.date,
		transferId: ctx.transferId,
		countOnly: false,
		sourceExpenseId: null,
		assetAccountId: ctx.accountId,
	});
}

export const createTransfer: MoneyMutation<CreateTransferInput, TransferValue> =
	{
		id: "transfer.create",
		touches: TRANSFER_FIGURES,
		scope: (input) => {
			const accountId = input.fromAccountId ?? input.toAccountId;
			return accountId ? { accountId } : {};
		},
		run: async (tx, input, actor) => {
			const value = await createTransferIn(tx, actor.userId, input);
			return {
				value,
				undo: {
					kind: "revert",
					mutation: "transfer.delete",
					rows: [{ table: "transfer", id: value.transferId }],
				},
			};
		},
	};

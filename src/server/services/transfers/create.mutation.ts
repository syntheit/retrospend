/**
 * transfer.create (MONEY-MOVES §2.3 to §2.7): one move between two of your
 * own places, as a Transfer and one leg per place. The Transfer and Exchange
 * sheet previews this same mutation (R30), so "What this changes" is what
 * Save writes. Kinds: TRANSFER, EXCHANGE, CARD_PAYMENT, WITHDRAWAL,
 * DEBT_PAYMENT. A null account is Not tracked (N75): the move still lands
 * there, so net worth never jumps.
 */
import { randomUUID } from "node:crypto";
import type {
	BudgetEffect,
	derivedRate,
	TransferKind,
} from "@retrospend/domain/transfers/plan";
import {
	type CountedMove,
	sideCurrency,
	type TransferLegRow,
	type TransferSide,
	transferRows,
} from "@retrospend/domain/transfers/rows";
import type { Money } from "~/server/figures/registry";
import { createExpenseIn } from "~/server/services/expense.service";
import type { MoneyMutation } from "~/server/services/preview/types";
import { withUserZone } from "~/server/services/user-time-zone";
import type { Prisma } from "~prisma";
import { moveDay } from "../accounts/dates";
import {
	type AccountChange,
	type AccountRow,
	homeCurrencyOf,
	lockAccounts,
	lockOpenAccount,
	ratePickFor,
	writeLeg,
} from "../accounts/ledger";
import { asBadRequest } from "../rate-types";
import { type BudgetSideResult, recordBudgetSide } from "./budget-side";
import { restoreTransferStash, type TransferStash } from "./stash";

type Tx = Prisma.TransactionClient;

export const TRANSFER_FIGURES = [
	"netWorth",
	"accounts.balance",
	"notTracked",
	"netWorthChange.exchange",
	"spent",
	// The budget side (envelope/wealth.service.ts) moves these (R30).
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"budget.heldForOthers",
	"envelope.left",
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
	/**
	 * Set only by the undo of a delete (signed in its token, never in a plain
	 * request): the budget side and fee fields as they were stored.
	 */
	readonly restore?: TransferStash | null;
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
	/** The reference rate itself (home per unit), for "Official 1,450". */
	readonly referenceRate: ReturnType<typeof derivedRate>;
	readonly accounts: readonly AccountChange[];
	/** What the legs did to net worth: the exchange result, and the fee. */
	readonly netWorthEffect: Money | null;
	readonly budget: BudgetEffect & { readonly side: BudgetSideResult };
	readonly feeExpenseId: string | null;
}

interface Side extends TransferSide {
	readonly account: AccountRow | null;
}

/** Locks and reads an account side, or checks the currency of Not tracked. */
async function sideOf(
	tx: Tx,
	userId: string,
	accountId: string | null,
	currency: string | null | undefined,
): Promise<Side> {
	const account = accountId
		? await lockOpenAccount(tx, userId, accountId)
		: null;
	const side = { account, currency };
	asBadRequest(() => sideCurrency(side));
	return side;
}

/** What a move needs from the database before its rows are computed: its places and rates. */
async function resolveMove(tx: Tx, userId: string, input: CreateTransferInput) {
	const date = moveDay(input.date, new Date(), input.timeZone);
	await lockAccounts(tx, [
		input.fromAccountId,
		input.toAccountId,
		input.fee?.accountId,
	]);
	const home = await homeCurrencyOf(tx, userId);
	const from = await sideOf(
		tx,
		userId,
		input.fromAccountId,
		input.fromCurrency,
	);
	const to = await sideOf(tx, userId, input.toAccountId, input.toCurrency);
	const feeAccount = input.fee?.accountId
		? await lockOpenAccount(tx, userId, input.fee.accountId)
		: null;
	// The fee account's currency too: a fee in a third currency is valued at
	// the day's rate like the legs, not at the account's stored one.
	const pick = await ratePickFor(tx, [
		home,
		sideCurrency(from),
		sideCurrency(to),
		...(feeAccount ? [feeAccount.currency] : []),
	]);
	return { date, home, from, to, feeAccount, pick };
}

type Written = {
	readonly accounts: ReadonlyMap<string, AccountRow>;
	readonly userId: string;
};

const legOf = (tx: Tx, w: Written, leg: TransferLegRow) =>
	writeLeg(tx, w.userId, {
		account: leg.accountId ? (w.accounts.get(leg.accountId) ?? null) : null,
		currency: leg.currency,
		amount: leg.amount,
		date: leg.date,
		source: leg.source,
		transferId: leg.transferId,
		...(leg.expenseId ? { expenseId: leg.expenseId } : {}),
		home: leg.home,
	});

export async function createTransferIn(
	tx: Tx,
	userId: string,
	given: CreateTransferInput,
): Promise<TransferValue> {
	// Resolved once here: the fee row reads the same zone as the move's day.
	const input = await withUserZone(tx, userId, given);
	const move = await resolveMove(tx, userId, input);
	const transferId = input.id ?? randomUUID();
	const rows = asBadRequest(() =>
		transferRows({
			from: move.from,
			to: move.to,
			fromAmount: input.fromAmount,
			toAmount: input.toAmount,
			kind: input.kind,
			pick: move.pick,
			homeCurrency: move.home,
			date: move.date,
			timeZone: input.timeZone,
			note: input.note,
			fee: input.fee && {
				amount: input.fee.amount,
				account: move.feeAccount,
			},
			ids: { transfer: transferId, feeExpense: randomUUID() },
		}),
	);
	const w: Written = {
		userId,
		accounts: new Map(
			[move.from.account, move.to.account, move.feeAccount].flatMap((a) =>
				a ? [[a.id, a] as const] : [],
			),
		),
	};
	await tx.transfer.create({ data: { userId, ...rows.transfer } });
	// Counted units move first: the legs' trigger then caps them at what each
	// account holds once the money has moved.
	await moveCounted(tx, rows.countedMoves);
	const changes: AccountChange[] = [];
	for (const leg of rows.legs) {
		const change = await legOf(tx, w, leg);
		if (change) changes.push(change);
	}
	if (rows.fee) {
		const expense = await createExpenseIn(tx, userId, rows.fee.expense);
		const change = await legOf(tx, w, {
			...rows.fee.leg,
			expenseId: expense.id,
		});
		await tx.transfer.update({
			where: { id: transferId },
			data: { feeExpenseId: expense.id },
		});
		if (change) mergeChange(changes, change);
	}
	const effect = rows.budget;
	const leaves = effect.effect === "leaves";
	const side = await budgetSideOf(tx, userId, effect, {
		transferId,
		date: move.date,
		envelopeId: (leaves ? input.envelopeId : input.putIn) ?? null,
		accountId: rows.budgetAccountId,
	});
	if (input.restore)
		await restoreTransferStash(
			tx,
			userId,
			{ transferId, feeExpenseId: rows.fee?.expense.id ?? null },
			input.restore,
		);
	const { transfer } = rows;
	return {
		transferId,
		kind: transfer.kind,
		fromAmount: transfer.fromAmount,
		fromCurrency: transfer.fromCurrency,
		toAmount: transfer.toAmount,
		toCurrency: transfer.toCurrency,
		rate: rows.rate,
		...rows.reference,
		accounts: changes,
		netWorthEffect: rows.netWorthEffect,
		budget: { ...effect, side },
		feeExpenseId: rows.fee?.expense.id ?? null,
	};
}

/** A fee from an account the move already changed joins its row: before the move, after the fee. */
function mergeChange(changes: AccountChange[], change: AccountChange) {
	const i = changes.findIndex((c) => c.accountId === change.accountId);
	const first = changes[i];
	if (first) changes[i] = { ...first, after: change.after };
	else changes.push(change);
}

/** D4: counted units leave the source and follow the money (the rows say how many). */
async function moveCounted(tx: Tx, moves: readonly CountedMove[]) {
	for (const { accountId, delta } of moves) {
		await tx.assetAccount.update({
			where: { id: accountId },
			data: {
				countedUnits: delta.isNegative()
					? { decrement: delta.neg().toString() }
					: { increment: delta.toString() },
			},
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
			const envelopeId = input.envelopeId ?? input.putIn;
			return {
				...(accountId ? { accountId } : {}),
				...(envelopeId ? { envelopeId } : {}),
			};
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

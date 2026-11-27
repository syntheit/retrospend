/**
 * transfer.delete on the device: deleteTransferIn
 * (src/server/services/transfers/delete.mutation.ts) over the store. The legs
 * go back through the leg writer (applyLegs, as the trigger), the counted units
 * the move took are given back and the ones it gave are taken away (never
 * below zero), each account is capped at what it holds (cappedCounted, the
 * one owner), and the transfer and its fee expense go.
 *
 * The device deletes only what it can see whole: the transfer's own row with
 * every column a Wealth write reads, its two legs (and the fee's), the
 * accounts they name and the fee's expense, and no budget side (a Wealth
 * transfer row the server takes away with the move). Anything less, or a
 * budget the device cannot read, is the server's: TransferOnlineError, nothing
 * written. Undo puts the rows back as they were (the token LocalDb.write
 * returns), which is the server's undo as far as the rows go; the server's
 * own undo is signed and restores through its stash (transfers/stash.ts).
 *
 * Run through LocalDb.write or LocalDb.preview.
 */
import { cappedCounted } from "@retrospend/domain/accounts/places";
import { dec } from "@retrospend/domain/precise-decimal";
import { putAccount } from "./account-kit";
import { removeLegs } from "./account-legs";
import type { LegRow } from "./accounts";
import { NotFoundError } from "./errors";
import type { ExpenseRow } from "./expenses";
import type { WriteFn } from "./local-db";
import type { TableRows } from "./port";
import type { Repos } from "./repos";
import { refusingTransfer, TransferOnlineError } from "./transfer-kit";

export const TRANSFER_DELETE = "transfer.delete";

export const TRANSFER_NOT_FOUND = "Transfer not found";

export interface DeleteTransferInput {
	readonly id: string;
}

export interface TransferDeleted {
	readonly transfer: TableRows["transfers"];
	readonly legs: readonly LegRow[];
	readonly feeExpense: ExpenseRow | null;
}

type TransferRow = TableRows["transfers"];

/** Every column a Wealth write reads: a row an older pull wrote lacks the newer ones. */
const COMPLETE_COLUMNS = [
	"kind",
	"fromAccountId",
	"fromAmount",
	"toAccountId",
	"toAmount",
	"countedFromUnits",
	"countedToUnits",
	"note",
] as const satisfies readonly (keyof TransferRow)[];

/** Whether the device holds all of the move: its row's columns, its legs, their accounts and its fee's expense. */
function holdsAll(r: Repos, t: TransferRow, legs: readonly LegRow[]): boolean {
	if (COMPLETE_COLUMNS.some((c) => t[c] === undefined)) return false;
	// One leg per place, and one for the fee.
	if (legs.length !== (t.feeExpenseId ? 3 : 2)) return false;
	if (legs.some((l) => l.accountId && !r.accounts.get(l.accountId)))
		return false;
	for (const id of [t.fromAccountId, t.toAccountId])
		if (id && !r.accounts.get(id)) return false;
	return !t.feeExpenseId || r.expenses.get(t.feeExpenseId) !== undefined;
}

/** The counted units a move took and gave go back, then each account is capped at what it holds. */
function restoreCounted(r: Repos, t: TransferRow): void {
	const from = t.fromAccountId && r.accounts.get(t.fromAccountId)?.account;
	if (from && dec(t.countedFromUnits).gt(0))
		putAccount(r, {
			...from,
			countedUnits: dec(from.countedUnits).add(t.countedFromUnits).toFixed(),
		});
	const to = t.toAccountId && r.accounts.get(t.toAccountId)?.account;
	if (to && dec(t.countedToUnits).gt(0)) {
		// The counted units may have moved on since; never below zero.
		const left = dec(to.countedUnits).sub(t.countedToUnits);
		putAccount(r, {
			...to,
			countedUnits: (left.lt(0) ? dec(0) : left).toFixed(),
		});
	}
	for (const id of [t.fromAccountId, t.toAccountId]) {
		const account = id && r.accounts.get(id)?.account;
		if (!account) continue;
		const capped = cappedCounted(
			account.type,
			dec(account.countedUnits),
			dec(account.balance),
		);
		if (!capped.eq(dec(account.countedUnits)))
			putAccount(r, { ...account, countedUnits: capped.toFixed() });
	}
}

export function deleteTransfer(
	input: DeleteTransferInput,
): WriteFn<TransferDeleted> {
	return (r) =>
		refusingTransfer(() => {
			const transfer = r.transfers.get(input.id);
			if (!transfer) throw new NotFoundError(TRANSFER_NOT_FOUND);
			const legs = r.accounts.legsOfTransfer(transfer.id);
			if (!holdsAll(r, transfer, legs))
				throw new TransferOnlineError("incomplete_transfer");
			// Whether a budget side exists is only known once the budget reads whole.
			if (r.budget.status() !== "ready")
				throw new TransferOnlineError("budget_not_ready");
			if (r.wealthMoves.list().some((w) => w.transferId === transfer.id))
				throw new TransferOnlineError("has_budget_side");
			removeLegs(r.accounts, legs);
			restoreCounted(r, transfer);
			r.transfers.remove(transfer.id);
			const feeExpense = transfer.feeExpenseId
				? (r.expenses.get(transfer.feeExpenseId)?.expense ?? null)
				: null;
			if (feeExpense) r.expenses.remove(feeExpense.id);
			return { transfer, legs, feeExpense };
		});
}

/**
 * expense.update and expense.delete on the device: the edit and delete the
 * server runs through the domain core (expense-write/edit.ts), here over the
 * store. The core owns every rule and its order; this file is the port (the
 * row, the category and the rate table read from the store, the patch written
 * to it) and what a device cannot do:
 *
 * - Spreads: a spread parent is refused (SPREAD_NOT_ON_DEVICE), and so is a
 *   form that asks for one. A spread part is not reachable, as on the server.
 * - Transfer fees: a row a transfer names as its fee has a leg. That is only
 *   known once the transfers pull has reached the position the expenses pull
 *   did, so an edit or delete made before that is refused with "Sync first",
 *   never guessed. A shared expense is never a row here (its shares carry the
 *   shared transaction's id), so there is nothing to refuse.
 *
 * Run through LocalDb.write (which returns the undo token) or LocalDb.preview.
 * An edit's token pins the home currency, so an undo after the home changed
 * is refused (undo.ts).
 */
import {
	type EditInput,
	type ExpenseEditPort,
	type ExpensePatch,
	deleteExpense as deleteExpenseRow,
	editExpense,
	type StoredExpense,
} from "@retrospend/domain/expense-write/edit";
import { ENTRY_POLICY } from "@retrospend/domain/expense-write/policy";
import {
	EditRefusal,
	bookedInOtherHome,
	otherHomeMessage,
	SPREAD_NOT_ON_DEVICE,
} from "@retrospend/domain/expense-write/refusals";
import { dec } from "@retrospend/domain/precise-decimal";
import { positionReached } from "./budget-gate";
import {
	parseAmount,
	rateBookOf,
	refuseBadForm,
	refusing,
} from "./expense-create";
import type { ExpenseRow } from "./expenses";
import type { WriteFn } from "./local-db";
import { InvalidInputError } from "./port";
import { categoryKindOf } from "./reference";
import type { Repos } from "./repos";

export const EXPENSE_UPDATE = "expense.update";
export const EXPENSE_DELETE = "expense.delete";

/** What an edit or delete of a transfer's fee waits for. */
export const SYNC_FIRST = "Sync first";

/** What the device needs beyond the form to edit or delete a row. */
export interface DeviceWriteContext {
	/**
	 * The sync cursors of the two entities a fee check reads. A transfer's fee
	 * is an expense the device can only recognise from its transfer, so both
	 * writes wait until the transfers pull has reached the position the
	 * expenses pull did (the pull order is expenses, then transfers).
	 */
	cursors: Readonly<Partial<Record<"expenses" | "transfers", string>>>;
}

export type UpdateExpenseInput = EditInput & DeviceWriteContext;

export interface DeleteExpenseInput extends DeviceWriteContext {
	id: string;
}

const text = (v: { toString(): string } | null | undefined) =>
	v === null || v === undefined ? null : dec(v).toFixed();

/** A row as the core reads it; a row without its booked rate cannot be edited. */
function storedOf(row: ExpenseRow, r: Repos): StoredExpense {
	if (row.exchangeRate === undefined || row.pricingSource === undefined)
		throw new InvalidInputError("This expense has no booked rate");
	return {
		id: row.id,
		title: row.title ?? "",
		amount: dec(row.amount).toFixed(),
		currency: row.currency,
		date: row.date,
		direction: row.direction,
		isAmortizedChild: row.isAmortizedChild ?? false,
		isAmortizedParent: row.isAmortizedParent,
		hasLegs: r.transfers.list().some((t) => t.feeExpenseId === row.id),
		exchangeRate: dec(row.exchangeRate).toFixed(),
		amountInUSD: dec(row.amountInUSD).toFixed(),
		rateType: row.rateType ?? null,
		homeCurrency: row.homeCurrency,
		homeRate: text(row.homeRate),
		homeAmount: text(row.homeAmount),
		pricingSource: row.pricingSource,
		location: row.location ?? null,
		description: row.description ?? null,
		categoryId: row.categoryId ?? null,
		excludeFromAnalytics: row.excludeFromAnalytics,
	};
}

/** The row after the patch: what the patch names changes, the rest stays as stored. */
function patched(row: ExpenseRow, patch: ExpensePatch, r: Repos): ExpenseRow {
	return {
		...row,
		title: patch.title,
		amount: patch.amount,
		currency: patch.currency,
		date: new Date(patch.date.getTime()),
		exchangeRate: patch.exchangeRate,
		amountInUSD: patch.amountInUSD,
		rateType: patch.rateType,
		homeCurrency: patch.homeCurrency,
		homeRate: patch.homeRate,
		homeAmount: patch.homeAmount,
		pricingSource: patch.pricingSource ?? row.pricingSource,
		location: patch.location,
		description: patch.description,
		categoryId: patch.categoryId,
		categoryKind: categoryKindOf(patch.categoryId, (id) =>
			r.categories.get(id),
		),
		isAmortizedParent: patch.isAmortizedParent,
		excludeFromAnalytics:
			patch.excludeFromAnalytics ?? row.excludeFromAnalytics,
	};
}

/** The core's port over the store. `done` is the row the write stored, or the one a delete removed. */
function storePort(r: Repos): ExpenseEditPort & { done(): ExpenseRow } {
	let done: ExpenseRow | undefined;
	return {
		done() {
			if (!done) throw new Error("The write reached no row");
			return done;
		},
		expense: async (id) => {
			const found = r.expenses.get(id);
			return found ? storedOf(found.expense, r) : null;
		},
		category: async (id) => r.categories.get(id) ?? null,
		rateBook: async () => rateBookOf(r),
		write: async (id, patch) => {
			const { expense, shares } = r.expenses.require(id);
			done = patched(expense, patch, r);
			r.expenses.update({ expense: done, shares });
			return storedOf(done, r);
		},
		remove: async (row) => {
			done = r.expenses.require(row.id).expense;
			r.expenses.remove(row.id);
		},
	};
}

/**
 * Refuses until the transfers the expenses point at have been pulled. Anything
 * short of "reached" (no cursor, another epoch, a reset, behind) refuses.
 */
function refuseUntilTransfersCaughtUp({ cursors }: DeviceWriteContext) {
	const expenses = cursors.expenses;
	if (
		expenses === undefined ||
		positionReached(cursors, ["transfers"], expenses) !== "reached"
	)
		throw new InvalidInputError(SYNC_FIRST);
}

/** A spread parent is the server's: its parts are rows the device never edits. */
function refuseSpreadParent(row: StoredExpense) {
	if (row.isAmortizedParent)
		throw new EditRefusal("badRequest", SPREAD_NOT_ON_DEVICE);
}

/** The write function for an edit; pass it to LocalDb.write or LocalDb.preview. */
export function updateExpense(input: UpdateExpenseInput): WriteFn<ExpenseRow> {
	return async (r) => {
		refuseUntilTransfersCaughtUp(input);
		refuseBadForm(input);
		const port = storePort(r);
		await refusing(async () =>
			editExpense(
				port,
				{ ...input, amount: parseAmount(input.amount).toFixed() },
				ENTRY_POLICY,
				{
					afterRead: async (row) => {
						// A typed rate pinned to a home the person no longer has (an undo).
						const home = r.settings.require().homeCurrency;
						const booked = input.customRate?.home;
						if (bookedInOtherHome(booked, home))
							throw new EditRefusal("badRequest", otherHomeMessage(booked));
						refuseSpreadParent(row);
					},
				},
			),
		);
		return port.done();
	};
}

/** The write function for a delete; the row goes with the shares it has (none, on the device). */
export function deleteExpense(input: DeleteExpenseInput): WriteFn<ExpenseRow> {
	return async (r) => {
		refuseUntilTransfersCaughtUp(input);
		const port = storePort(r);
		await refusing(() =>
			deleteExpenseRow(port, input.id, ENTRY_POLICY, {
				beforeRemove: async (row) => refuseSpreadParent(row),
			}),
		);
		return port.done();
	};
}

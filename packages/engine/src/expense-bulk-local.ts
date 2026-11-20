/**
 * Bulk categorize and bulk delete on the device: the same domain core the
 * server runs (expense-write/bulk.ts), here over the store. The core owns which
 * rows a bulk action reaches, which it skips and why, the category rule and the
 * category's analytics default; this file is the port and what a device cannot
 * do:
 *
 * - Transfer fees: a row a transfer names as its fee is only known once the
 *   transfers pull has reached the expenses pull's position, so both actions
 *   wait ("Sync first") until it has, as an edit and a delete do.
 * - Spreads: a delete of a spread parent is refused (SPREAD_NOT_ON_DEVICE)
 *   and the whole set stays as it was, since the server would take the parent
 *   and its parts together. Categorize skips a spread parent, as the server does.
 *
 * Run through LocalDb.write, whose one token undoes every row the action
 * changed, or LocalDb.preview. The phone sends a bulk action at once, online
 * only, and only over rows with nothing unsent or acked (design 9), so this
 * runs over pulled rows. Undo needs undo.ts to put back every row at once; the
 * generic revert token already does, and a gone category is dropped by the
 * server's undo but not by the device's (PR8's undo.ts owns that).
 */
import {
	type Categorized,
	type CategoryMove,
	categorize,
	type DeletedMany,
	deleteMany,
	type ExpenseBulkPort,
} from "@retrospend/domain/expense-write/bulk";
import { refusing } from "./expense-create";
import {
	type DeviceWriteContext,
	refuseSpreadParent,
	refuseUntilTransfersCaughtUp,
	storedOf,
} from "./expense-write-local";
import type { WriteFn } from "./local-db";
import { deviceMutation, EXPENSE_FIGURES } from "./preview";
import { categoryKindOf } from "./reference";
import type { Repos } from "./repos";

export const EXPENSE_CATEGORIZE = "expense.categorize";
export const EXPENSE_DELETE_MANY = "expense.deleteMany";

export interface CategorizeInput extends DeviceWriteContext {
	moves: readonly CategoryMove[];
	/** An undo: a category deleted since leaves its rows uncategorized instead of failing. */
	lenient?: boolean;
}

export interface DeleteManyInput extends DeviceWriteContext {
	ids: readonly string[];
}

/** The core's bulk port over the store. */
function bulkPort(r: Repos): ExpenseBulkPort {
	return {
		rows: async (ids) =>
			ids.flatMap((id) => {
				const found = r.expenses.get(id);
				return found ? [storedOf(found.expense, r)] : [];
			}),
		category: async (id) => r.categories.get(id) ?? null,
		setCategory: async (rows, categoryId, excluded) => {
			for (const { id } of rows) {
				const { expense, shares } = r.expenses.require(id);
				r.expenses.update({
					expense: {
						...expense,
						categoryId,
						categoryKind: categoryKindOf(categoryId, (c) =>
							r.categories.get(c),
						),
						excludeFromAnalytics: excluded ?? expense.excludeFromAnalytics,
					},
					shares,
				});
			}
		},
		remove: async (row) => {
			r.expenses.remove(row.id);
		},
	};
}

/** The write function for a bulk categorize; pass it to LocalDb.write or LocalDb.preview. */
export function categorizeExpenses(
	input: CategorizeInput,
): WriteFn<Categorized> {
	return async (r) => {
		refuseUntilTransfersCaughtUp(input);
		return refusing(() =>
			categorize(bulkPort(r), input.moves, { lenient: input.lenient }),
		);
	};
}

/** The write function for a bulk delete; the rows it skips come back with their reasons. */
export function deleteExpenses(input: DeleteManyInput): WriteFn<DeletedMany> {
	return async (r) => {
		refuseUntilTransfersCaughtUp(input);
		return refusing(() =>
			deleteMany(bulkPort(r), input.ids, {
				beforeRemove: async (row) => refuseSpreadParent(row),
			}),
		);
	};
}

/** The server's expense.categorize, on the device: it touches the figures a category's analytics default can move. */
export const EXPENSE_CATEGORIZE_MUTATION = deviceMutation({
	id: EXPENSE_CATEGORIZE,
	touches: EXPENSE_FIGURES,
	write: categorizeExpenses,
});

/** The server's expense.deleteMany, on the device. */
export const EXPENSE_DELETE_MANY_MUTATION = deviceMutation({
	id: EXPENSE_DELETE_MANY,
	touches: EXPENSE_FIGURES,
	write: deleteExpenses,
});

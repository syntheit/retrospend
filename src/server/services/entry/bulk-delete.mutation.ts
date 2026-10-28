/**
 * Deleting several personal expenses as one money mutation (R30, R15): the
 * preview is one dry run of the whole set, so its "after" figures are exact,
 * and one undo puts every row back.
 *
 * - expense.deleteMany: each id goes as expense.delete takes it (the row and
 *   its spread parts, with a signed snapshot). An id that is not yours or is
 *   gone is skipped, and so is a transfer's fee (it goes with its transfer).
 *   Refused when nothing can go. `expected` (a redo) runs only while each
 *   row still has the stamp the undo left.
 * - expense.restoreMany: the undo, every snapshot back in one transaction;
 *   a row that is back already refuses the whole undo.
 */
import { TRPCError } from "@trpc/server";
import { ExpenseService } from "../expense.service";
import type { MoneyMutation } from "../preview/types";
import { EXPENSE_FIGURES } from "./expense.mutation";
import {
	type ExpenseSnapshot,
	restoreExpense,
	snapshotExpense,
} from "./expense-snapshot";
import { type RestoreToken, readRestore, signRestore } from "./restore-token";

export interface DeleteManyInput {
	readonly ids: readonly string[];
	/** id to the updatedAt it must still have; set by a redo. */
	readonly expected?: Readonly<Record<string, string>>;
}

export interface DeletedMany {
	readonly ids: readonly string[];
	readonly skipped: readonly string[];
	/** expense.restoreMany with these brings every deleted row back. */
	readonly restores: readonly RestoreToken[];
}

const stale = () =>
	new TRPCError({
		code: "CONFLICT",
		message: "This expense changed since. Undo is no longer safe.",
	});

export const deleteExpensesBulk: MoneyMutation<DeleteManyInput, DeletedMany> = {
	id: "expense.deleteMany",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		const ids = [...new Set(input.ids)];
		const rows = await tx.expense.findMany({
			where: {
				id: { in: ids },
				userId: actor.userId,
				direction: "OUT",
				isAmortizedChild: false,
			},
			select: {
				id: true,
				updatedAt: true,
				_count: { select: { accountLegs: true } },
			},
		});
		const byId = new Map(rows.map((r) => [r.id, r]));
		const service = new ExpenseService(tx);
		const deleted: string[] = [];
		const skipped: string[] = [];
		const restores: RestoreToken[] = [];
		for (const id of ids) {
			const row = byId.get(id);
			const want = input.expected?.[id];
			if (want && row && row.updatedAt.toISOString() !== want) throw stale();
			if (!row || row._count.accountLegs > 0) {
				skipped.push(id);
				continue;
			}
			const snapshot = await snapshotExpense(tx, actor.userId, id);
			await service.deleteExpense(actor.userId, id);
			deleted.push(id);
			restores.push(signRestore(snapshot));
		}
		if (deleted.length === 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "None of these expenses can be deleted here.",
			});
		}
		return {
			value: { ids: deleted, skipped, restores },
			undo: {
				kind: "revert",
				mutation: "expense.restoreMany",
				rows: deleted.map((id) => ({ table: "expense", id })),
			},
		};
	},
};

export interface RestoredMany {
	readonly ids: readonly string[];
	/** id to the updatedAt the restore left, for the redo's check. */
	readonly stamps: Readonly<Record<string, string>>;
}

/** The undo of expense.deleteMany: the signed rows back as they were stored. */
export const restoreExpensesBulk: MoneyMutation<
	{ tokens: readonly RestoreToken[] },
	RestoredMany
> = {
	id: "expense.restoreMany",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		const ids: string[] = [];
		for (const token of input.tokens) {
			const snapshot = readRestore<ExpenseSnapshot>(token);
			ids.push(await restoreExpense(tx, actor.userId, snapshot));
		}
		const rows = await tx.expense.findMany({
			where: { id: { in: ids }, userId: actor.userId },
			select: { id: true, updatedAt: true },
		});
		return {
			value: {
				ids,
				stamps: Object.fromEntries(
					rows.map((r) => [r.id, r.updatedAt.toISOString()]),
				),
			},
			undo: {
				kind: "revert",
				mutation: "expense.deleteMany",
				rows: ids.map((id) => ({ table: "expense", id })),
			},
		};
	},
};

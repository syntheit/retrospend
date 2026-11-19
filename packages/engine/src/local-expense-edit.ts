/** The local adapter for the expense edit conformance cases: a memory store behind LocalDb. */
import { createExpense, EXPENSE_CREATE } from "./expense-create";
import { cursor } from "./device/fake-api";
import type { ExpenseEditAdapter } from "./expense-edit-conformance";
import {
	deleteExpense,
	EXPENSE_DELETE,
	EXPENSE_UPDATE,
	updateExpense,
} from "./expense-write-local";
import { LocalDb } from "./local-db";
import { bookedOf, seededStore } from "./local-expense-create";
import type { MemoryStore } from "./memory-store";

/** Transfers pulled as far as expenses: the device may edit and delete. */
const CAUGHT_UP = { expenses: cursor("200"), transfers: cursor("200") };

export function localExpenseEditAdapter(): ExpenseEditAdapter {
	let store: MemoryStore;
	let db: LocalDb;
	return {
		async reset(seed) {
			store = await seededStore(seed);
			db = new LocalDb(store);
		},
		async create(input) {
			await db.write(EXPENSE_CREATE, createExpense(input));
		},
		async setRates(rates) {
			await store.transaction((tx) => {
				for (const r of tx.list("rates")) tx.delete("rates", r.id);
				for (const r of rates)
					tx.put("rates", {
						id: `${r.currency}:${r.type}:${r.date.toISOString()}`,
						...r,
					});
			});
		},
		async edit(base, fields) {
			const { value, undo } = await db.write(
				EXPENSE_UPDATE,
				updateExpense({
					...base,
					...fields,
					cursors: CAUGHT_UP,
				}),
			);
			return {
				expense: bookedOf(value),
				undo: async () => {
					await db.undo(undo);
				},
			};
		},
		async remove(id) {
			const { undo } = await db.write(
				EXPENSE_DELETE,
				deleteExpense({ id, cursors: CAUGHT_UP }),
			);
			return {
				undo: async () => {
					await db.undo(undo);
				},
			};
		},
		async plant(id, kind) {
			await store.transaction((tx) => {
				const row = tx.get("expenses", id);
				if (!row) throw new Error(`no expense ${id}`);
				if (kind === "income") tx.put("expenses", { ...row, direction: "IN" });
				else if (kind === "spreadPart")
					tx.put("expenses", { ...row, isAmortizedChild: true });
				else
					tx.put("transfers", {
						id: "t1",
						date: row.date,
						toAccountId: null,
						toAmount: "0",
						toCurrency: row.currency,
						feeExpenseId: id,
					});
			});
		},
		async addCategory(id, kind) {
			await store.transaction((tx) =>
				tx.put("categories", {
					id,
					kind,
					name: id,
					color: "teal",
					icon: null,
					excludeByDefault: false,
				}),
			);
		},
		async read(id) {
			const row = store.get("expenses", id);
			return row ? bookedOf(row) : null;
		},
	};
}

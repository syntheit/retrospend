/** The local adapter for the expense edit conformance cases: a memory store behind LocalDb. */
import { createExpense, EXPENSE_CREATE } from "./expense-create";
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
					transfersSynced: true,
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
				deleteExpense({ id, transfersSynced: true }),
			);
			return {
				undo: async () => {
					await db.undo(undo);
				},
			};
		},
		async read(id) {
			const row = store.get("expenses", id);
			return row ? bookedOf(row) : null;
		},
	};
}

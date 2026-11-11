/** The local adapter for the expense create conformance cases: a memory store behind LocalDb. */
import { createExpense, EXPENSE_CREATE } from "./expense-create";
import type {
	BookedExpense,
	ExpenseCreateAdapter,
	ExpenseSeed,
} from "./expense-create-conformance";
import type { ExpenseRow } from "./expenses";
import { LocalDb } from "./local-db";
import { MemoryStore } from "./memory-store";
import { SETTINGS_ID } from "./port";

/** The booked fields of a stored row; a row without them was not made by a create. */
export function bookedOf(row: ExpenseRow): BookedExpense {
	const { exchangeRate, homeRate, pricingSource, homeCurrency, homeAmount } =
		row;
	if (
		exchangeRate === undefined ||
		homeRate == null ||
		pricingSource === undefined ||
		homeCurrency === null ||
		homeAmount === null
	)
		throw new Error(`expense ${row.id} has no booked rate`);
	return {
		status: row.status,
		direction: row.direction,
		entryKind: row.entryKind,
		inType: row.inType,
		isAmortizedParent: row.isAmortizedParent,
		excludeFromAnalytics: row.excludeFromAnalytics,
		categoryKind: row.categoryKind,
		categoryId: row.categoryId ?? null,
		date: row.date,
		currency: row.currency,
		amount: String(row.amount),
		amountInUSD: String(row.amountInUSD),
		exchangeRate,
		rateType: row.rateType ?? null,
		homeCurrency,
		homeRate,
		homeAmount: String(homeAmount),
		pricingSource,
	};
}

/** A store holding the seed: the settings row and one row per rate. */
export async function seededStore(seed: ExpenseSeed): Promise<MemoryStore> {
	const store = new MemoryStore();
	await store.transaction((tx) => {
		tx.put("settings", {
			id: SETTINGS_ID,
			homeCurrency: seed.homeCurrency,
			timeZone: seed.timeZone,
			startDay: 1,
			hiddenProjectIds: [],
			...(seed.defaultRateTypes
				? { defaultRateTypes: seed.defaultRateTypes }
				: {}),
		});
		for (const r of seed.rates)
			tx.put("rates", {
				id: `${r.currency}:${r.type}:${r.date.toISOString()}`,
				...r,
			});
	});
	return store;
}

export function localExpenseCreateAdapter(): ExpenseCreateAdapter {
	let store = new MemoryStore();
	let db = new LocalDb(store);
	return {
		async reset(seed) {
			store = await seededStore(seed);
			db = new LocalDb(store);
		},
		async create(input) {
			const { value, undo } = await db.write(
				EXPENSE_CREATE,
				createExpense(input),
			);
			return {
				expense: bookedOf(value),
				undo: async () => {
					await db.undo(undo);
				},
			};
		},
		expenseIds: async () => store.list("expenses").map((e) => e.id),
	};
}

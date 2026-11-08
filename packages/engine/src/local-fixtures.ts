/** Helpers the local write conformance cases share. */
import { fixtureRow } from "./fixtures";
import { LocalDb } from "./local-db";
import { type Store, TABLE_NAMES } from "./port";

/** Every row of every table, for before and after comparisons. */
export const dump = (store: Store) =>
	Object.fromEntries(TABLE_NAMES.map((t) => [t, store.list(t)]));

export const expense = (id: string, amount = "1000.50") => ({
	...fixtureRow("expenses", id),
	amount,
	homeAmount: amount,
});
export const share = (id: string, expenseId: string, shareAmount = "250") => ({
	...fixtureRow("shares", id),
	expenseId,
	shareAmount,
});
export const aggregate = (id: string) => ({
	expense: expense(id),
	shares: [share(`${id}-s1`, id), share(`${id}-s2`, id, "300")],
});

export async function setup(makeStore: () => Store | Promise<Store>) {
	const store = await makeStore();
	return { store, db: new LocalDb(store) };
}

/**
 * Conformance cases for undo and the children of an expense or account: an
 * undo never orphans a row added after the write, nor revives a parent next
 * to children it was not written with. See repo-conformance.ts for the shape.
 */
import { type ConformanceCase, expectEqual, expectThrows } from "./conformance";
import { ConflictError } from "./errors";
import { fixtureRow } from "./fixtures";
import type { LocalDb } from "./local-db";
import { dump, expense, setup, share } from "./local-fixtures";
import type { TableName } from "./port";
import type { UndoToken } from "./undo";

const acc = fixtureRow("accounts", "acc-1");
const leg = { ...fixtureRow("legs", "l1"), accountId: "acc-1" };
const snapshot = { ...fixtureRow("snapshots", "sn1"), accountId: "acc-1" };
const bare = { account: acc, legs: [], snapshots: [] };

/** Undoing `token` is refused, names `stray`, and writes nothing. */
async function refused(
	db: LocalDb,
	token: UndoToken,
	stray: { table: TableName; id: string },
	dumpNow: () => unknown,
	what: string,
) {
	const before = JSON.stringify(dumpNow());
	let thrown: unknown;
	await expectThrows(
		async () => {
			try {
				await db.undo(token);
			} catch (e) {
				thrown = e;
				throw e;
			}
		},
		what,
		ConflictError,
	);
	expectEqual(
		(thrown as ConflictError).rows,
		[stray],
		`${what}: names the row`,
	);
	expectEqual(JSON.stringify(dumpNow()), before, `${what}: nothing written`);
}

export const childCases: ConformanceCase[] = [
	{
		name: "undo of an account create is refused when a leg was added since",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const created = await db.write("account.create", (r) =>
				r.accounts.create(bare),
			);
			await db.write("account.leg", (r) => r.accounts.addLeg(leg));
			await refused(
				db,
				created.undo,
				{ table: "legs", id: "l1" },
				() => dump(store),
				"leg",
			);
		},
	},
	{
		name: "undo of an account create is refused when a snapshot was added since",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const created = await db.write("account.create", (r) =>
				r.accounts.create(bare),
			);
			await db.write("account.snapshot", (r) =>
				r.accounts.addSnapshot(snapshot),
			);
			await refused(
				db,
				created.undo,
				{ table: "snapshots", id: "sn1" },
				() => dump(store),
				"snapshot",
			);
		},
	},
	{
		name: "undo of an expense create is refused when a share was added since",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const created = await db.write("expense.create", (r) =>
				r.expenses.create({ expense: expense("e1"), shares: [] }),
			);
			await db.write("expense.update", (r) =>
				r.expenses.update({
					expense: expense("e1"),
					shares: [share("late", "e1")],
				}),
			);
			await refused(
				db,
				created.undo,
				{ table: "shares", id: "late" },
				() => dump(store),
				"share",
			);
		},
	},
	{
		name: "undo of a delete is refused when another child exists now, for an expense and an account",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			await db.write("expense.create", (r) =>
				r.expenses.create({
					expense: expense("e1"),
					shares: [share("s1", "e1")],
				}),
			);
			const gone = await db.write("expense.delete", (r) =>
				r.expenses.remove("e1"),
			);
			await store.transaction((tx) => tx.put("shares", share("late", "e1")));
			await refused(
				db,
				gone.undo,
				{ table: "shares", id: "late" },
				() => dump(store),
				"share next to a revived expense",
			);

			await db.write("account.create", (r) =>
				r.accounts.create({ account: acc, legs: [leg], snapshots: [] }),
			);
			const removed = await db.write("account.remove", (r) =>
				r.accounts.remove("acc-1"),
			);
			await store.transaction((tx) =>
				tx.put("legs", { ...leg, id: "late-leg" }),
			);
			await refused(
				db,
				removed.undo,
				{ table: "legs", id: "late-leg" },
				() => dump(store),
				"leg next to a revived account",
			);
		},
	},
	{
		name: "undo of a create still works when the children are the ones the write made",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const created = await db.write("account.create", (r) =>
				r.accounts.create({ account: acc, legs: [leg], snapshots: [snapshot] }),
			);
			await db.undo(created.undo);
			for (const t of ["accounts", "legs", "snapshots"] as const)
				expectEqual(store.list(t), [], t);
		},
	},
];

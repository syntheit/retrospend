/**
 * Conformance cases for the repositories, run against any Store: the
 * in-memory one today, the SQLCipher one on the phone later. Same shape as
 * conformance.ts: register each with `it(c.name, () => c.run(makeStore))`;
 * `makeStore` returns a fresh, empty store. Undo and preview cases are in
 * undo-conformance.ts; local-conformance.ts joins both.
 */
import { type ConformanceCase, expectEqual, expectThrows } from "./conformance";
import { NotFoundError } from "./errors";
import { fixtureRow } from "./fixtures";
import { aggregate, expense, setup, share } from "./local-fixtures";
import { InvalidInputError } from "./port";

export const repositoryCases: ConformanceCase[] = [
	{
		name: "expenses keep their shares: create, get, update, remove",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e2")),
			);
			const reads = db.reads();
			expectEqual(reads.expenses.get("e1"), aggregate("e1"), "get");
			expectEqual(reads.expenses.list().length, 2, "list");
			expectEqual(
				store.list("shares").map((s) => s.id),
				["e1-s1", "e1-s2", "e2-s1", "e2-s2"],
				"shares",
			);
			// Update drops the share that is no longer listed and edits the rest.
			const edited = {
				expense: expense("e1", "2000"),
				shares: [share("e1-s1", "e1", "999")],
			};
			await db.write("expense.update", (r) => r.expenses.update(edited));
			expectEqual(db.reads().expenses.get("e1"), edited, "updated");
			expectEqual(
				db.reads().expenses.get("e2"),
				aggregate("e2"),
				"e2 untouched",
			);
			const removed = await db.write("expense.delete", (r) =>
				r.expenses.remove("e1"),
			);
			expectEqual(removed.value, true, "removed");
			expectEqual(db.reads().expenses.get("e1"), undefined, "gone");
			expectEqual(
				store.list("shares").map((s) => s.id),
				["e2-s1", "e2-s2"],
				"its shares went with it",
			);
			const again = await db.write("expense.delete", (r) =>
				r.expenses.remove("e1"),
			);
			expectEqual(again.value, false, "remove missing");
		},
	},
	{
		name: "repositories refuse a duplicate, a missing row and a share of another expense",
		async run(makeStore) {
			const { db } = await setup(makeStore);
			await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			await expectThrows(
				() => db.write("x", (r) => r.expenses.create(aggregate("e1"))),
				"duplicate expense",
				InvalidInputError,
			);
			await expectThrows(
				() => db.write("x", (r) => r.expenses.update(aggregate("nope"))),
				"update missing",
				NotFoundError,
			);
			await expectThrows(
				() =>
					db.write("x", (r) =>
						r.expenses.create({
							expense: expense("e3"),
							shares: [share("e1-s1", "e3")],
						}),
					),
				"share id of another expense",
				InvalidInputError,
			);
			await expectThrows(
				() =>
					db.write("x", (r) =>
						r.expenses.create({
							expense: expense("e4"),
							shares: [share("e4-s1", "e1")],
						}),
					),
				"share naming another expense",
				InvalidInputError,
			);
		},
	},
	{
		name: "accounts keep their legs and snapshots, and removing one takes them along",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const acc = fixtureRow("accounts", "acc-1");
			const leg = { ...fixtureRow("legs", "l1"), accountId: "acc-1" };
			const snap = { ...fixtureRow("snapshots", "sn1"), accountId: "acc-1" };
			await db.write("account.create", (r) =>
				r.accounts.create({ account: acc, legs: [leg], snapshots: [snap] }),
			);
			const other = { ...fixtureRow("legs", "l2"), accountId: "acc-2" };
			await expectThrows(
				() =>
					db.write("x", (r) =>
						r.accounts.create({
							account: fixtureRow("accounts", "acc-2"),
							legs: [leg],
							snapshots: [],
						}),
					),
				"leg of another account",
				InvalidInputError,
			);
			await expectThrows(
				() => db.write("x", (r) => r.accounts.addLeg(other)),
				"leg of a missing account",
				NotFoundError,
			);
			const leg2 = { ...fixtureRow("legs", "l3"), accountId: "acc-1" };
			await db.write("account.leg", (r) => r.accounts.addLeg(leg2));
			await db.write("account.edit", (r) =>
				r.accounts.updateAccount({ ...acc, balance: "70000" }),
			);
			expectEqual(
				db.reads().accounts.get("acc-1"),
				{
					account: { ...acc, balance: "70000" },
					legs: [leg, leg2],
					snapshots: [snap],
				},
				"aggregate",
			);
			await db.write("account.remove", (r) => r.accounts.remove("acc-1"));
			for (const t of ["accounts", "legs", "snapshots"] as const)
				expectEqual(store.list(t), [], `${t} cleared`);
		},
	},
	{
		name: "movements are append-only and a recurring template takes plain CRUD",
		async run(makeStore) {
			const { db } = await setup(makeStore);
			const m = fixtureRow("budgetMovements", "m1");
			await db.write("budget.book", (r) => r.budgetMovements.book(m));
			await expectThrows(
				() => db.write("x", (r) => r.budgetMovements.book(m)),
				"movement id reused",
				InvalidInputError,
			);
			expectEqual(db.reads().budgetMovements.inMonth(202603), [m], "in month");
			expectEqual(
				db.reads().budgetMovements.inMonth(202604),
				[],
				"other month",
			);
			const t = fixtureRow("recurringTemplates", "t1");
			await db.write("recurring.create", (r) => r.recurringTemplates.create(t));
			await db.write("recurring.update", (r) =>
				r.recurringTemplates.update({ ...t, isActive: false }),
			);
			expectEqual(
				db.reads().recurringTemplates.get("t1"),
				{ ...t, isActive: false },
				"template edited",
			);
			await db.write("recurring.delete", (r) =>
				r.recurringTemplates.remove("t1"),
			);
			expectEqual(db.reads().recurringTemplates.list(), [], "template gone");
		},
	},
];

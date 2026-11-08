/**
 * Conformance cases for undo and preview of local writes, run against any
 * Store. See repo-conformance.ts for the shape.
 */
import { type ConformanceCase, expectEqual, expectThrows } from "./conformance";
import { ConflictError } from "./errors";
import { fixtureRow } from "./fixtures";
import { aggregate, dump, expense, setup, share } from "./local-fixtures";

export const undoCases: ConformanceCase[] = [
	{
		name: "undo after a create removes the rows, after an edit and a delete puts them back exactly",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const empty = dump(store);
			const created = await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			const afterCreate = dump(store);
			await db.undo(created.undo);
			expectEqual(dump(store), empty, "create undone");

			await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			const edited = await db.write("expense.update", (r) =>
				r.expenses.update({
					expense: expense("e1", "7"),
					shares: [share("e1-s2", "e1", "1"), share("e1-s3", "e1", "2")],
				}),
			);
			await db.undo(edited.undo);
			expectEqual(dump(store), afterCreate, "edit undone");

			const deleted = await db.write("expense.delete", (r) =>
				r.expenses.remove("e1"),
			);
			expectEqual(store.list("expenses"), [], "deleted");
			await db.undo(deleted.undo);
			expectEqual(dump(store), afterCreate, "delete undone");
		},
	},
	{
		name: "undo of an undo puts the write back",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const created = await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			const afterCreate = dump(store);
			const redo = await db.undo(created.undo);
			await db.undo(redo);
			expectEqual(dump(store), afterCreate, "redone");
			// The first token is spent: its rows are as the write left them again,
			// so it applies once more, which is the same rows as before.
			await db.undo(created.undo);
			expectEqual(store.list("expenses"), [], "undone again");
		},
	},
	{
		name: "undo refuses with a conflict when a row changed after the write, and writes nothing",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const created = await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			// One share edited later: the whole undo is refused, the other rows stay.
			await db.write("expense.update", (r) =>
				r.expenses.update({
					expense: expense("e1"),
					shares: [share("e1-s1", "e1", "250"), share("e1-s2", "e1", "301")],
				}),
			);
			const before = dump(store);
			await expectThrows(() => db.undo(created.undo), "edited", ConflictError);
			expectEqual(dump(store), before, "nothing written");
			try {
				await db.undo(created.undo);
			} catch (e) {
				expectEqual(
					(e as ConflictError).rows,
					[{ table: "shares", id: "e1-s2" }],
					"names the row",
				);
			}

			// A deleted row is a change too, and so is an edit that came back to its value on a different row.
			const edit = await db.write("expense.update", (r) =>
				r.expenses.update({ expense: expense("e1", "5"), shares: [] }),
			);
			await db.write("expense.delete", (r) => r.expenses.remove("e1"));
			await expectThrows(
				() => db.undo(edit.undo),
				"deleted since",
				ConflictError,
			);
		},
	},
	{
		name: "a write whose function throws leaves the store as it was and returns no token",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const before = dump(store);
			await expectThrows(
				() =>
					db.write("expense.create", (r) => {
						r.expenses.create(aggregate("e1"));
						throw new Error("boom");
					}),
				"throws",
				Error,
			);
			expectEqual(dump(store), before, "rolled back");
		},
	},
	{
		name: "preview returns the diff, equals the write, and leaves the store unchanged",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			const before = dump(store);
			const edit = (r: Parameters<Parameters<typeof db.preview>[0]>[0]) =>
				r.expenses.update({
					expense: expense("e1", "42"),
					shares: [share("e1-s1", "e1", "21")],
				});
			const preview = await db.preview(edit);
			expectEqual(dump(store), before, "store unchanged");
			expectEqual(
				preview.changes.map((c) => [c.table, c.id]),
				[
					["expenses", "e1"],
					["shares", "e1-s1"],
					["shares", "e1-s2"],
				],
				"rows it would touch",
			);
			const [exp, kept, dropped] = preview.changes;
			expectEqual(exp?.before, aggregate("e1").expense, "expense before");
			expectEqual(exp?.after, expense("e1", "42"), "expense after");
			expectEqual(kept?.after, share("e1-s1", "e1", "21"), "share after");
			expectEqual(dropped?.after, null, "dropped share");
			const written = await db.write("expense.update", edit);
			expectEqual(
				written.undo.kind === "revert" && written.undo.changes,
				preview.changes,
				"preview equals the write",
			);
		},
	},
	{
		name: "a write that changes nothing has no changes, and its undo does nothing",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			const before = dump(store);
			const same = await db.write("expense.update", (r) =>
				r.expenses.update(aggregate("e1")),
			);
			expectEqual(
				same.undo.kind === "revert" && same.undo.changes,
				[],
				"no changes",
			);
			await db.undo(same.undo);
			expectEqual(dump(store), before, "unchanged");
		},
	},
	{
		name: "booking movements gets a mirror undo that books the opposite movement, once",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const m = {
				...fixtureRow("budgetMovements", "m1"),
				fromEnvelopeId: "env-a",
				toEnvelopeId: "env-b",
				amount: "1200",
			};
			const booked = await db.write("budget.book", (r) =>
				r.budgetMovements.book(m),
			);
			expectEqual(booked.undo.kind, "mirror", "mirror token");
			const redo = await db.undo(booked.undo);
			expectEqual(
				store.list("budgetMovements"),
				[
					m,
					{
						...m,
						id: "m1:mirror",
						fromEnvelopeId: "env-b",
						toEnvelopeId: "env-a",
					},
				],
				"original kept, mirror booked",
			);
			await expectThrows(
				() => db.undo(booked.undo),
				"second undo",
				ConflictError,
			);
			expectEqual(store.list("budgetMovements").length, 2, "no third movement");
			expectEqual(redo.kind, "mirror", "redo is a mirror of the mirror");
			await db.undo(redo);
			expectEqual(
				store.list("budgetMovements").map((x) => x.id),
				["m1", "m1:mirror", "m1:mirror:mirror"],
				"redo books again",
			);
		},
	},
	{
		name: "a mirror of two movements is refused whole when one was already taken back",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const m1 = { ...fixtureRow("budgetMovements", "m1"), amount: "1" };
			const m2 = { ...fixtureRow("budgetMovements", "m2"), amount: "2" };
			const both = await db.write("budget.setup", (r) => {
				r.budgetMovements.book(m1);
				r.budgetMovements.book(m2);
			});
			await db.write("budget.back", (r) => r.budgetMovements.mirror("m2"));
			const before = dump(store);
			await expectThrows(
				() => db.undo(both.undo),
				"m2 taken back",
				ConflictError,
			);
			expectEqual(dump(store), before, "m1 was not mirrored");
		},
	},
	{
		name: "undo preview shows what the undo would change and applies nothing",
		async run(makeStore) {
			const { store, db } = await setup(makeStore);
			const created = await db.write("expense.create", (r) =>
				r.expenses.create(aggregate("e1")),
			);
			const before = dump(store);
			const changes = await db.previewUndo(created.undo);
			expectEqual(changes.length, 3, "expense and two shares");
			expectEqual(
				changes.every((c) => c.after === null),
				true,
				"all removed",
			);
			expectEqual(dump(store), before, "unchanged");
		},
	},
];

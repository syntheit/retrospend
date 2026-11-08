import { describe, expect, it } from "vitest";
import { fixtureRow } from "./fixtures";
import {
	ConflictError,
	LocalDb,
	MemoryStore,
	sameValue,
	TransactionError,
} from "./index";
import { localWriteCases } from "./local-conformance";

describe("local writes conformance (memory store)", () => {
	for (const c of localWriteCases)
		it(c.name, () => c.run(() => new MemoryStore()));
});

const agg = () => ({
	expense: fixtureRow("expenses", "e1"),
	shares: [fixtureRow("shares", "s1")],
});
const withAmount = (amount: string) => ({
	...agg(),
	expense: { ...fixtureRow("expenses", "e1"), amount },
});

describe("local writes on the memory store", () => {
	it("the token holds the rows exactly as stored: frozen, with their dates", async () => {
		const db = new LocalDb(new MemoryStore());
		const { undo } = await db.write("expense.create", (r) =>
			r.expenses.create(agg()),
		);
		if (undo.kind !== "revert") throw new Error("expected a revert token");
		const row = undo.changes.find((c) => c.table === "expenses")?.after;
		expect(Object.isFrozen(row)).toBe(true);
		expect(row).toMatchObject({ date: new Date("2026-03-05T12:00:00Z") });
	});

	it("an undo that conflicts does not commit: the persistence hook never sees it", async () => {
		const commits: number[] = [];
		const db = new LocalDb(
			new MemoryStore({ onCommit: (c) => void commits.push(c.length) }),
		);
		const { undo } = await db.write("expense.create", (r) =>
			r.expenses.create(agg()),
		);
		await db.write("expense.update", (r) => r.expenses.update(withAmount("9")));
		await expect(db.undo(undo)).rejects.toBeInstanceOf(ConflictError);
		expect(commits).toEqual([2, 2]);
	});

	it("a preview does not reach the persistence hook", async () => {
		const commits: number[] = [];
		const db = new LocalDb(
			new MemoryStore({ onCommit: (c) => void commits.push(c.length) }),
		);
		await db.preview((r) => r.expenses.create(agg()));
		await db.previewUndo({ kind: "revert", mutation: "x", changes: [] });
		expect(commits).toEqual([]);
	});

	it("reads see a moment of the store: a later write does not change them", async () => {
		const db = new LocalDb(new MemoryStore());
		const reads = db.reads();
		await db.write("expense.create", (r) => r.expenses.create(agg()));
		expect(reads.expenses.list()).toEqual([]);
		expect(db.reads().expenses.list()).toHaveLength(1);
	});

	it("a write sees its own earlier writes, and two writes in one function undo as one", async () => {
		const db = new LocalDb(new MemoryStore());
		const { value, undo } = await db.write("expense.create-and-edit", (r) => {
			r.expenses.create(agg());
			r.expenses.update(withAmount("5"));
			return r.expenses.get("e1")?.expense.amount;
		});
		expect(value).toBe("5");
		await db.undo(undo);
		expect(db.reads().expenses.list()).toEqual([]);
	});
});

describe("nested calls", () => {
	const db = () => new LocalDb(new MemoryStore({ beginTimeoutMs: 60_000 }));

	it("a write, preview or undo started inside a preview throws instead of waiting", async () => {
		const d = db();
		const { undo } = await d.write("expense.create", (r) =>
			r.expenses.create(agg()),
		);
		await expect(
			d.preview(() => d.write("x", (r) => r.expenses.remove("e1"))),
		).rejects.toBeInstanceOf(TransactionError);
		await expect(
			d.preview(() => d.preview((r) => r.expenses.remove("e1"))),
		).rejects.toBeInstanceOf(TransactionError);
		await expect(d.previewUndo(undo)).resolves.toHaveLength(2);
		await expect(
			d.previewUndo({ kind: "revert", mutation: "x", changes: [] }),
		).resolves.toEqual([]);
	});

	it("a preview started inside a write throws, and the write is rolled back", async () => {
		const d = db();
		await expect(
			d.write("x", (r) => {
				r.expenses.create(agg());
				return d.preview((q) => q.expenses.remove("e1"));
			}),
		).rejects.toBeInstanceOf(TransactionError);
		expect(d.reads().expenses.list()).toEqual([]);
	});

	it("a preview that throws rethrows its own error and changes nothing", async () => {
		const d = db();
		await expect(
			d.preview((r) => {
				r.expenses.create(agg());
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(d.reads().expenses.list()).toEqual([]);
	});
});

/** A stand-in for Decimal: equal by value through `equals`. */
class Amount {
	constructor(readonly n: number) {}
	equals(o: Amount) {
		return this.n === o.n;
	}
}

describe("sameValue", () => {
	it("compares dates by time, objects by content and value classes through equals", () => {
		expect(sameValue(new Date(5), new Date(5))).toBe(true);
		expect(sameValue(new Date(5), new Date(6))).toBe(false);
		expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
		expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(sameValue(new Amount(1.5), new Amount(1.5))).toBe(true);
		expect(sameValue(new Amount(1.5), new Amount(1.6))).toBe(false);
		expect(sameValue(new Date("nope"), new Date("nope"))).toBe(true);
		expect(sameValue(new Date("nope"), new Date(5))).toBe(false);
		expect(sameValue(null, undefined)).toBe(false);
		expect(sameValue("1.0", "1")).toBe(false);
	});
});

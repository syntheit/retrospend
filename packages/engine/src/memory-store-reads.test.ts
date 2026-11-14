/**
 * What the store's read path promises beyond the port's conformance suites:
 * the fast row copy matches the generic one, and (below) the sorted-order and
 * transaction-list caches never serve a stale list.
 */
import { describe, expect, it } from "vitest";
import { createExpense, EXPENSE_CREATE } from "./expense-create";
import { vectors } from "./expense-create-vectors";
import { fixtureRow } from "./fixtures";
import { LocalDb } from "./local-db";
import { seededStore } from "./local-expense-create";
import { dump } from "./local-fixtures";
import { genericOut, MemoryStore } from "./memory-store";
import { SINGLE_ROW_IDS, TABLE_NAMES } from "./port";
import {
	createDevicePreviewRunner,
	EXPENSE_CREATE_MUTATION,
} from "./preview";
import { deviceFigures } from "./registry";

const rate = (id: string) => fixtureRow("rates", id);

describe("a row as a reader gets it", () => {
	/** A row with a Date inside a nested object, which only the generic walk can copy. */
	const nested = {
		...fixtureRow("categories", "z"),
		meta: { seen: new Date("2026-05-01T00:00:00Z"), tags: ["a"] },
	};

	it("is what the generic copy gives, in every table: same keys in the same order, same values, frozen when a Date was copied", async () => {
		const store = new MemoryStore();
		await store.transaction((tx) => {
			for (const t of TABLE_NAMES)
				tx.put(t, fixtureRow(t, SINGLE_ROW_IDS[t] ?? "r") as never);
			tx.put("categories", nested as never);
		});
		for (const t of TABLE_NAMES) {
			const id = SINGLE_ROW_IDS[t] ?? "r";
			const expected = genericOut(fixtureRow(t, id)) as object;
			const hasDate = Object.values(expected).some((v) => v instanceof Date);
			for (const read of [store.get(t, id), store.list(t)[0]] as object[]) {
				expect(Object.keys(read)).toEqual(Object.keys(expected));
				expect(read).toEqual(expected);
				expect(Object.isFrozen(read)).toBe(true);
				if (hasDate)
					for (const [k, v] of Object.entries(read))
						if (v instanceof Date)
							expect(v).not.toBe((expected as Record<string, unknown>)[k]);
			}
		}
		const deep = store.get("categories", "z") as unknown as typeof nested;
		expect(deep).toEqual(nested);
		expect(Object.isFrozen(deep)).toBe(true);
		expect(deep.meta.seen).not.toBe(nested.meta.seen);
	});

	it("is a new row with a new Date on every read, and every list is a new frozen array", () => {
		const store = new MemoryStore({
			rows: { expenses: [fixtureRow("expenses", "e")] },
		});
		const [a, b] = [store.get("expenses", "e"), store.get("expenses", "e")];
		expect(a).not.toBe(b);
		expect(a?.date).not.toBe(b?.date);
		expect(a?.date.getTime()).toBe(b?.date.getTime());
		const list = store.list("expenses");
		expect(Object.isFrozen(list)).toBe(true);
		expect(list[0]).not.toBe(a);
		expect(store.list("expenses")).not.toBe(list);
	});

	it("reads the same inside a transaction before commit and from the store after", async () => {
		const store = new MemoryStore();
		const tx = await store.begin();
		tx.put("rates", rate("a"));
		const inTx = tx.get("rates", "a");
		await tx.commit();
		const after = store.get("rates", "a");
		expect(after).toEqual(inTx);
		expect(after?.date).not.toBe(inTx?.date);
	});
});

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

describe("the id order a store keeps per committed table", () => {
	it("matches a fresh sort after an out-of-order insert, an update, a delete, a failed commit and a rollback", async () => {
		let fail = false;
		const store = new MemoryStore({
			rows: { rates: [rate("m"), rate("c")] },
			onCommit: () => {
				if (fail) throw new Error("disk full");
			},
		});
		// Each list below is read before the next write, so the order is cached.
		expect(ids(store.list("rates"))).toEqual(["c", "m"]);
		await store.transaction((tx) => {
			tx.put("rates", rate("z"));
			tx.put("rates", rate("a"));
		});
		expect(ids(store.list("rates"))).toEqual(["a", "c", "m", "z"]);
		await store.transaction((tx) =>
			tx.put("rates", { ...rate("c"), rate: "9" }),
		);
		expect(store.list("rates").map((r) => [r.id, r.rate])).toEqual([
			["a", "1545"],
			["c", "9"],
			["m", "1545"],
			["z", "1545"],
		]);
		await store.transaction((tx) => tx.delete("rates", "m"));
		expect(ids(store.list("rates"))).toEqual(["a", "c", "z"]);

		fail = true;
		await expect(
			store.transaction((tx) => {
				tx.put("rates", rate("b"));
				tx.delete("rates", "a");
			}),
		).rejects.toThrow("disk full");
		expect(ids(store.list("rates"))).toEqual(["a", "c", "z"]);

		fail = false;
		const tx = await store.begin();
		tx.put("rates", rate("b"));
		tx.delete("rates", "z");
		tx.rollback();
		expect(ids(store.list("rates"))).toEqual(["a", "c", "z"]);
		await store.transaction((t) => t.put("rates", rate("b")));
		expect(ids(store.list("rates"))).toEqual(["a", "b", "c", "z"]);
	});

	it("a snapshot keeps its own order and rows across later commits, whether or not it was listed first", async () => {
		const store = new MemoryStore({
			rows: {
				rates: [rate("b")],
				categories: [fixtureRow("categories", "k")],
			},
		});
		const listed = store.snapshot();
		expect(ids(listed.list("rates"))).toEqual(["b"]);
		const unlisted = store.snapshot();
		await store.transaction((tx) => {
			tx.put("rates", rate("a"));
			tx.put("rates", { ...rate("b"), rate: "2" });
		});
		expect(ids(store.list("rates"))).toEqual(["a", "b"]);
		for (const snap of [listed, unlisted])
			expect(snap.list("rates").map((r) => [r.id, r.rate])).toEqual([
				["b", "1545"],
			]);
		// A table the commit did not touch is read the same from both states.
		expect(ids(store.list("categories"))).toEqual(["k"]);
		expect(ids(listed.list("categories"))).toEqual(["k"]);
	});

	it("a list a caller edits never reaches a later list", () => {
		// Categories hold no Date, so their list is the one a caller could edit.
		const store = new MemoryStore({
			rows: { categories: [fixtureRow("categories", "k")] },
		});
		const first = store.list("categories") as unknown[];
		first.push("junk");
		first.length = 0;
		expect(ids(store.list("categories"))).toEqual(["k"]);
	});
});

describe("a transaction's list", () => {
	const withRate = (id: string, value: string) => ({ ...rate(id), rate: value });

	it("follows a put, a delete and a put of one id, and savepoints that commit and roll back", async () => {
		const store = new MemoryStore({ rows: { rates: [rate("b"), rate("d")] } });
		const tx = await store.begin();
		/** Reads twice, so the second read is served from the memo and must agree. */
		const read = (t: { list: typeof tx.list }) => {
			const rows = () =>
				t.list("rates").map((r) => `${r.id}:${r.rate}`);
			const once = rows();
			expect(rows()).toEqual(once);
			return once;
		};
		expect(read(tx)).toEqual(["b:1545", "d:1545"]);
		tx.put("rates", withRate("c", "1"));
		expect(read(tx)).toEqual(["b:1545", "c:1", "d:1545"]);
		tx.delete("rates", "c");
		expect(read(tx)).toEqual(["b:1545", "d:1545"]);
		tx.put("rates", withRate("c", "2"));
		tx.delete("rates", "b");
		expect(read(tx)).toEqual(["c:2", "d:1545"]);

		const outer = tx.savepoint();
		outer.put("rates", rate("a"));
		outer.put("rates", withRate("c", "3"));
		expect(read(outer)).toEqual(["a:1545", "c:3", "d:1545"]);
		const inner = outer.savepoint();
		inner.delete("rates", "d");
		inner.put("rates", rate("e"));
		expect(read(inner)).toEqual(["a:1545", "c:3", "e:1545"]);
		inner.rollback();
		expect(read(outer)).toEqual(["a:1545", "c:3", "d:1545"]);
		const kept = outer.savepoint();
		kept.put("rates", rate("b"));
		kept.delete("rates", "a");
		expect(read(kept)).toEqual(["b:1545", "c:3", "d:1545"]);
		await kept.commit();
		expect(read(outer)).toEqual(["b:1545", "c:3", "d:1545"]);
		await outer.commit();
		expect(read(tx)).toEqual(["b:1545", "c:3", "d:1545"]);

		const dropped = tx.savepoint();
		dropped.put("rates", rate("a"));
		expect(read(dropped)).toEqual(["a:1545", "b:1545", "c:3", "d:1545"]);
		dropped.rollback();
		expect(read(tx)).toEqual(["b:1545", "c:3", "d:1545"]);
		// Nothing reached the store before commit.
		expect(store.list("rates").map((r) => r.id)).toEqual(["b", "d"]);
		await tx.commit();
		expect(
			store.list("rates").map((r) => `${r.id}:${r.rate}`),
		).toEqual(["b:1545", "c:3", "d:1545"]);
	});

	it("a savepoint's list follows its parent when the parent rolls back under it", async () => {
		const store = new MemoryStore({ rows: { rates: [rate("a")] } });
		const tx = await store.begin();
		tx.put("rates", rate("b"));
		const child = tx.savepoint();
		child.put("rates", rate("c"));
		expect(ids(child.list("rates"))).toEqual(["a", "b", "c"]);
		tx.rollback();
		expect(ids(child.list("rates"))).toEqual(["a", "c"]);
	});

	it("reads a table it never wrote as the store has it, with its own Date objects", async () => {
		const store = new MemoryStore({
			rows: { rates: [rate("a")], legs: [fixtureRow("legs", "l")] },
		});
		const tx = await store.begin();
		tx.put("rates", rate("b"));
		const legs = tx.list("legs");
		expect(legs).toEqual(store.list("legs"));
		expect(legs[0]?.date).not.toBe(store.list("legs")[0]?.date);
		legs[0]?.date.setTime(0);
		expect(tx.list("legs")[0]?.date.toISOString()).toBe(
			"2026-03-01T00:00:00.000Z",
		);
		tx.rollback();
	});

	it("a read after a rolled-back transaction, and after one that failed to commit, sees only committed rows", async () => {
		let fail = false;
		const store = new MemoryStore({
			rows: { rates: [rate("a")] },
			onCommit: () => {
				if (fail) throw new Error("disk full");
			},
		});
		const tx = await store.begin();
		tx.put("rates", rate("b"));
		expect(tx.list("rates")).toHaveLength(2);
		tx.rollback();
		const failing = await store.begin();
		fail = true;
		failing.put("rates", rate("c"));
		expect(failing.list("rates")).toHaveLength(2);
		await expect(failing.commit()).rejects.toThrow("disk full");
		fail = false;
		const next = await store.begin();
		expect(ids(next.list("rates"))).toEqual(["a"]);
		next.put("rates", rate("b"));
		expect(ids(next.list("rates"))).toEqual(["a", "b"]);
		next.rollback();
	});

	it("a preview of a write, through LocalDb and through the device runner, leaves every list as it was, and a later write lands in order", async () => {
		const v = vectors[1] as (typeof vectors)[number];
		const store = await seededStore(v.seed);
		const before = dump(store);

		const db = new LocalDb(store);
		await db.preview(createExpense(v.input));
		expect(dump(store)).toEqual(before);

		const runner = createDevicePreviewRunner({
			store,
			figures: deviceFigures({ clock: () => v.input.date }),
			actor: { userId: "u1" },
		});
		await runner.preview(EXPENSE_CREATE_MUTATION, v.input);
		await runner.preview(EXPENSE_CREATE_MUTATION, v.input);
		expect(dump(store)).toEqual(before);
		expect(store.get("expenses", v.input.id)).toBeUndefined();

		await db.write(EXPENSE_CREATE, createExpense(v.input));
		expect(store.list("expenses").map((r) => r.id)).toEqual([v.input.id]);
		expect(store.list("rates")).toEqual(before.rates);
	});
});

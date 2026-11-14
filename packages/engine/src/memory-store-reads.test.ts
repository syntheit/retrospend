/**
 * What the store's read path promises beyond the port's conformance suites:
 * the fast row copy matches the generic one, and (below) the sorted-order and
 * transaction-list caches never serve a stale list.
 */
import { describe, expect, it } from "vitest";
import { fixtureRow } from "./fixtures";
import { genericOut, MemoryStore } from "./memory-store";
import { SINGLE_ROW_IDS, TABLE_NAMES } from "./port";

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

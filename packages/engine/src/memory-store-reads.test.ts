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

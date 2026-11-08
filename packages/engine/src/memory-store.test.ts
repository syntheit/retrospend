import { describe, expect, it, vi } from "vitest";
import { conformanceCases } from "./conformance";
import { fixtureRow } from "./fixtures";
import {
	type Change,
	InvalidInputError,
	MemoryStore,
	SETTINGS_ID,
	TABLE_NAMES,
	TransactionError,
} from "./index";

describe("memory store conformance", () => {
	for (const c of conformanceCases)
		it(c.name, () => c.run(() => new MemoryStore()));
});

const rate = (id: string) => fixtureRow("rates", id);
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

describe("memory store", () => {
	it("starts with the rows it is given, in any table", () => {
		const store = new MemoryStore({
			rows: {
				expenses: [fixtureRow("expenses", "e1")],
				rates: [rate("r2"), rate("r1")],
			},
		});
		expect(ids(store.list("expenses"))).toEqual(["e1"]);
		expect(ids(store.list("rates"))).toEqual(["r1", "r2"]);
		expect(store.list("legs")).toEqual([]);
	});

	it("copy on write: a snapshot held across a commit shows the old rows, and the old list is not edited", async () => {
		const store = new MemoryStore({ rows: { rates: [rate("a")] } });
		const snap = store.snapshot();
		const before = snap.list("rates");
		await store.transaction((tx) => {
			tx.put("rates", { ...rate("a"), rate: "2000" });
			tx.put("rates", rate("b"));
		});
		expect(before.map((r) => [r.id, r.rate])).toEqual([["a", "1545"]]);
		expect(snap.get("rates", "a")?.rate).toBe("1545");
		expect(snap.get("rates", "b")).toBeUndefined();
		expect(store.get("rates", "a")?.rate).toBe("2000");
		expect(ids(store.list("rates"))).toEqual(["a", "b"]);
	});

	it("keeps no handle on the row a caller put", async () => {
		const store = new MemoryStore();
		const row = { ...rate("a") };
		await store.transaction((tx) => tx.put("rates", row));
		expect(() => {
			(row as { rate: string }).rate = "1";
		}).not.toThrow();
		expect(store.get("rates", "a")?.rate).toBe("1545");
		expect(Object.isFrozen(store.get("rates", "a"))).toBe(true);
	});

	it("a delete of a row that never existed changes nothing and reports false", async () => {
		const changes: Change[] = [];
		const store = new MemoryStore({ onCommit: (c) => void changes.push(...c) });
		const existed = await store.transaction((tx) => {
			tx.put("rates", rate("tmp"));
			tx.delete("rates", "tmp");
			return tx.delete("rates", "never");
		});
		expect(existed).toBe(false);
		expect(changes).toEqual([]);
	});

	it("hands the commit's changes to onCommit, deletes as null rows", async () => {
		const changes: Change[] = [];
		const store = new MemoryStore({
			rows: { rates: [rate("old")] },
			onCommit: (c) => void changes.push(...c),
		});
		await store.transaction((tx) => {
			tx.put("rates", rate("new"));
			tx.delete("rates", "old");
		});
		expect(changes.map((c) => [c.table, c.id, c.row === null])).toEqual([
			["rates", "new", false],
			["rates", "old", true],
		]);
	});

	it("a failed commit leaves no partial state, in any table, and the next transaction runs", async () => {
		let fail = true;
		const store = new MemoryStore({
			rows: { rates: [rate("keep")] },
			onCommit: () => {
				if (fail) throw new Error("disk full");
			},
		});
		const tx = await store.begin();
		for (const t of TABLE_NAMES)
			tx.put(t, fixtureRow(t, t === "settings" ? SETTINGS_ID : "new") as never);
		tx.delete("rates", "keep");
		await expect(tx.commit()).rejects.toThrow("disk full");
		for (const t of TABLE_NAMES)
			expect(ids(store.list(t))).toEqual(t === "rates" ? ["keep"] : []);
		expect(() => tx.list("rates")).toThrow(TransactionError);

		fail = false;
		await store.transaction((t) => t.put("rates", rate("after")));
		expect(ids(store.list("rates"))).toEqual(["after", "keep"]);
	});

	it("a failed commit does not release a queued transaction early", async () => {
		const order: string[] = [];
		const store = new MemoryStore({
			onCommit: async () => {
				await Promise.resolve();
				order.push("persisted");
				throw new Error("nope");
			},
		});
		const first = store
			.transaction((tx) => tx.put("rates", rate("a")))
			.catch(() => undefined);
		const second = store.transaction((tx) => {
			order.push(`second sees ${tx.list("rates").length}`);
		});
		await Promise.all([first, second]);
		expect(order).toEqual(["persisted", "second sees 0"]);
	});

	it("a savepoint cannot commit into a parent that already ended", async () => {
		const store = new MemoryStore();
		const tx = await store.begin();
		const child = tx.savepoint();
		child.put("rates", rate("a"));
		tx.rollback();
		await expect(child.commit()).rejects.toThrow(TransactionError);
		expect(store.list("rates")).toEqual([]);
	});

	it("a transaction left open holds the queue until it ends", async () => {
		const store = new MemoryStore();
		const open = await store.begin();
		let started = false;
		const next = store.begin().then((tx) => {
			started = true;
			tx.rollback();
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toBe(false);
		open.rollback();
		await next;
		expect(started).toBe(true);
	});

	describe("rows are deep copies", () => {
		const settings = (ids: string[]) => ({
			...fixtureRow("settings", SETTINGS_ID),
			hiddenProjectIds: ids,
		});

		it("an array changed after put changes neither the store nor an old snapshot", async () => {
			const store = new MemoryStore();
			const ids = ["a"];
			await store.transaction((tx) => tx.put("settings", settings(ids)));
			const snap = store.snapshot();
			ids.push("b");
			expect(store.get("settings", SETTINGS_ID)?.hiddenProjectIds).toEqual([
				"a",
			]);
			expect(snap.get("settings", SETTINGS_ID)?.hiddenProjectIds).toEqual([
				"a",
			]);
		});

		it("an array changed after put inside a still-open transaction changes nothing", async () => {
			const store = new MemoryStore();
			const ids = ["a"];
			const tx = await store.begin();
			tx.put("settings", settings(ids));
			ids.push("b");
			expect(tx.get("settings", SETTINGS_ID)?.hiddenProjectIds).toEqual(["a"]);
			await tx.commit();
			expect(store.get("settings", SETTINGS_ID)?.hiddenProjectIds).toEqual([
				"a",
			]);
		});

		it("an array read from the store cannot be edited", async () => {
			const store = new MemoryStore({ rows: { settings: [settings(["a"])] } });
			const read = store.get("settings", SETTINGS_ID)
				?.hiddenProjectIds as string[];
			expect(() => read.push("b")).toThrow(TypeError);
			expect(store.get("settings", SETTINGS_ID)?.hiddenProjectIds).toEqual([
				"a",
			]);
		});

		it("nested objects are copied, and a date changed after put changes nothing", async () => {
			const store = new MemoryStore();
			const category = { id: "c", name: "Rent", color: "teal", icon: null };
			const due = new Date("2026-04-01T00:00:00Z");
			await store.transaction((tx) =>
				tx.put("recurringTemplates", {
					...fixtureRow("recurringTemplates", "t"),
					category,
					nextDueDate: due,
				}),
			);
			category.name = "Changed";
			due.setTime(0);
			const row = store.get("recurringTemplates", "t");
			expect(row?.category?.name).toBe("Rent");
			expect(row?.nextDueDate.toISOString()).toBe("2026-04-01T00:00:00.000Z");
			expect(Object.isFrozen(row?.category)).toBe(true);
		});
	});

	it("settings refuses any id but user, in a seed too", () => {
		expect(
			() =>
				new MemoryStore({ rows: { settings: [fixtureRow("settings", "x")] } }),
		).toThrow(InvalidInputError);
	});

	describe("a transaction that waits for itself", () => {
		it("a nested transaction throws instead of hanging, and the outer rolls back", async () => {
			const store = new MemoryStore();
			await expect(
				store.transaction(async (tx) => {
					tx.put("rates", rate("outer"));
					await store.transaction((inner) => inner.put("rates", rate("inner")));
				}),
			).rejects.toThrow(/savepoint/);
			expect(store.list("rates")).toEqual([]);
			// The queue is intact.
			await store.transaction((tx) => tx.put("rates", rate("after")));
			expect(ids(store.list("rates"))).toEqual(["after"]);
		});

		it("a nested begin throws too", async () => {
			const store = new MemoryStore();
			await expect(store.transaction(() => store.begin())).rejects.toThrow(
				TransactionError,
			);
		});

		it("other callers queued meanwhile are not mistaken for nesting", async () => {
			const store = new MemoryStore();
			const first = store.transaction(async (tx) => {
				await Promise.resolve();
				tx.put("rates", rate("a"));
			});
			const second = store.transaction((tx) => tx.put("rates", rate("b")));
			await Promise.all([first, second]);
			expect(ids(store.list("rates"))).toEqual(["a", "b"]);
		});

		it("a begin waiting past the timeout throws at that time, and the queue moves on after", async () => {
			vi.useFakeTimers();
			try {
				const store = new MemoryStore({ beginTimeoutMs: 20 });
				const forgotten = await store.begin();
				let outcome: unknown = "pending";
				const waiting = store.begin().then(
					(tx) => {
						outcome = "started";
						tx.rollback();
					},
					(e: unknown) => {
						outcome = e;
					},
				);
				await vi.advanceTimersByTimeAsync(19);
				expect(outcome).toBe("pending");
				await vi.advanceTimersByTimeAsync(1);
				expect(outcome).toBeInstanceOf(TransactionError);
				expect((outcome as Error).message).toMatch(/waited 20 ms/);
				await waiting;

				// A timed-out begin takes no slot: once the forgotten one ends, the next runs.
				const next = store.transaction((tx) => tx.put("rates", rate("after")));
				forgotten.rollback();
				await next;
				expect(ids(store.list("rates"))).toEqual(["after"]);
			} finally {
				vi.useRealTimers();
			}
		});

		it("without a timeout a wait that ends in time is fine", async () => {
			const store = new MemoryStore({ beginTimeoutMs: 1000 });
			const open = await store.begin();
			const next = store.begin();
			open.rollback();
			(await next).rollback();
		});
	});
});

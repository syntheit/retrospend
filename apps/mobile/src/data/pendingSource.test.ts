import { ConflictError } from "@retrospend/engine";
import {
	chainOnCategory,
	refuseCategoryUncreate,
} from "@retrospend/engine/device";
import { createOutbox } from "./outbox";
import { bookedRow, booking, create, edit } from "./outboxFixtures";
import { createPendingSource } from "./pendingSource";
import { createMemoryStore } from "./store";

const T1 = "2026-10-15T15:00:01.000Z";

describe("pending source over the outbox", () => {
	it("gives the engine open and acked entries in one order, booked or not", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(create("e1", booking("e1", null, bookedRow("e1"))));
		await outbox.enqueue(create("plain"));
		await outbox.enqueue(
			edit(
				"u1",
				"e1",
				{ after: "e1" },
				booking("e1", bookedRow("e1"), bookedRow("e1", { amount: "120.00" }), {
					changed: ["amount"],
				}),
			),
		);
		await outbox.markSent("e1", { version: T1, pull: 2 });
		await outbox.markConflict("u1", "expense_changed");
		await source.refresh();
		const entries = source.entries();
		expect(entries.map((e) => e.clientId)).toEqual(["e1", "plain", "u1"]);
		expect(entries[1]).toMatchObject({
			entity: "expenses",
			targetId: "plain",
			payload: { id: "plain" },
			changes: [],
		});
		expect(entries[0]).toMatchObject({
			parked: false,
			ack: { version: T1, pull: 2 },
			changed: ["amount"],
		});
		expect(entries[2]).toMatchObject({ parked: true });
		expect(entries[2]?.ack).toBeUndefined();
		expect(
			(entries[2]?.changes[0]?.before as { version: unknown } | null)?.version,
		).toBe(T1);
	});

	it("reads a restarted run's acked entry with pull 0", async () => {
		const store = createMemoryStore();
		const outbox = createOutbox(store, "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(create("e1", booking("e1", null, bookedRow("e1"))));
		await outbox.markSent("e1", { version: T1, pull: 2 });
		await source.refresh();
		expect(source.entries()[0]?.ack?.pull).toBe(2);
		const restarted = createPendingSource(createOutbox(store, "a"));
		await restarted.refresh();
		expect(restarted.entries()[0]?.ack?.pull).toBe(0);
	});

	it("retire leaves the list at once and the store when idle", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(create("e1", booking("e1", null, bookedRow("e1"))));
		await outbox.markSent("e1", { version: T1 });
		await source.refresh();
		source.retire(["e1"]);
		expect(source.entries()).toEqual([]);
		await source.idle();
		expect(await outbox.acked()).toEqual([]);
	});

	it("reports an undone entry once", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(create("e1", booking("e1", null, bookedRow("e1"))));
		await outbox.markSent("e1", { version: T1 });
		await outbox.undone("e1");
		expect(source.takeLeft().map((l) => [l.entry.clientId, l.code])).toEqual([
			["e1", "undone"],
		]);
		expect(source.takeLeft()).toEqual([]);
	});

	it("marks an unbooked entry", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(
			create("e1", {
				bookedAt: 0,
				changes: [],
				changed: [],
				unbooked: "no_rate",
			}),
		);
		await source.refresh();
		expect(source.entries()[0]).toMatchObject({
			unbooked: "no_rate",
			changes: [],
		});
	});
});

describe("what the category guards read through the pending source", () => {
	const GIFTS = "g1";
	const category = (over: Record<string, unknown> = {}) => ({
		clientId: GIFTS,
		entity: "categories",
		kind: "create" as const,
		targetId: GIFTS,
		baseVersion: null,
		payload: { id: GIFTS, name: "Gifts", color: "pink" },
		...over,
	});
	const filed = (id: string, over: Record<string, unknown> = {}) => ({
		clientId: id,
		entity: "expenses",
		kind: "create" as const,
		targetId: id,
		baseVersion: null,
		payload: { id, categoryId: GIFTS, currency: "USD" },
		...over,
	});
	const NO_RATE = {
		bookedAt: 0,
		changes: [],
		changed: [],
		unbooked: "no_rate" as const,
	};

	it("refuses the undo of a create while an expense with no rate, or no booking at all, files into it", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		// Offline, no USD rate: Gifts is made (no booking either), a USD expense
		// is filed in it (unbooked), then Gifts is sent and acked.
		await outbox.enqueue(category());
		await outbox.enqueue(filed("x1", { device: NO_RATE }));
		await outbox.enqueue(filed("x2"));
		await outbox.markSent(GIFTS, { version: "0", pull: 1 });
		await source.refresh();
		expect(() => refuseCategoryUncreate(source.entries(), GIFTS)).toThrow(
			ConflictError,
		);
		try {
			refuseCategoryUncreate(source.entries(), GIFTS);
		} catch (e) {
			expect((e as ConflictError).rows).toEqual([
				{ table: "expenses", id: "x1" },
				{ table: "expenses", id: "x2" },
			]);
		}
	});

	it("reads a template edit's row from its target, since its payload names no id", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(category());
		await outbox.enqueue({
			clientId: "u1",
			entity: "recurring",
			kind: "update" as const,
			targetId: "t1",
			baseVersion: "v1",
			payload: { categoryId: GIFTS },
		});
		await source.refresh();
		try {
			refuseCategoryUncreate(source.entries(), GIFTS);
			throw new Error("not refused");
		} catch (e) {
			expect((e as ConflictError).rows).toEqual([
				{ table: "recurringTemplates", id: "t1" },
			]);
		}
	});

	it("does not refuse when nothing files into it, or only another category", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(category());
		await outbox.enqueue(
			filed("x1", { payload: { id: "x1", categoryId: "other" } }),
		);
		await source.refresh();
		expect(() => refuseCategoryUncreate(source.entries(), GIFTS)).not.toThrow();
	});

	it("chains on a category entry the device did not book, and on none once it is acked", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const source = createPendingSource(outbox);
		await outbox.enqueue(category());
		await source.refresh();
		expect(chainOnCategory(source.entries(), GIFTS)).toEqual([GIFTS]);
		expect(chainOnCategory(source.entries(), "other")).toEqual([]);
		await outbox.markSent(GIFTS, { version: "0", pull: 1 });
		await source.refresh();
		expect(chainOnCategory(source.entries(), GIFTS)).toEqual([]);
	});
});

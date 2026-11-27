import { createOutbox } from "./outbox";
import { bookedRow, booking, create, edit } from "./outboxFixtures";
import { createPendingSource } from "./pendingSource";
import { createMemoryStore } from "./store";

const T1 = "2026-10-15T15:00:01.000Z";

describe("pending source over the outbox", () => {
	it("gives the engine open and acked entries in one order, and only the device's", async () => {
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
		expect(entries.map((e) => e.clientId)).toEqual(["e1", "u1"]);
		expect(entries[0]).toMatchObject({
			parked: false,
			ack: { version: T1, pull: 2 },
			changed: ["amount"],
		});
		expect(entries[1]).toMatchObject({ parked: true });
		expect(entries[1]?.ack).toBeUndefined();
		expect(
			(entries[1]?.changes[0]?.before as { version: unknown } | null)?.version,
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

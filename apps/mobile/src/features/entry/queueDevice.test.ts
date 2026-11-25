import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import type { PendingWrite } from "./draft";
import {
	queueExpenseChange,
	saveEntry,
	takeFromOutbox,
	undoSaved,
} from "./queue";
import { createEntrySender, entryOutbox, forgetUndoTokens } from "./send";

// Saves under the dev flag: the device books first, an edit or a delete is
// queued behind what waits for the same row, and nothing stacks on or folds
// into an entry that may already be on the server. The sender for updates and
// deletes is PR10, so none leaves the phone here.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const SECRET = "Lunch with Zelda";
const write: PendingWrite = {
	entity: "expenses",
	label: SECRET,
	body: {
		id: ID,
		title: SECRET,
		amount: "100",
		currency: "USD",
		date: "2026-10-05",
	},
};

const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => mockWrites(),
}));

const row = (over: Record<string, unknown> = {}) => ({
	id: ID,
	currency: "USD",
	amount: "100.00",
	homeAmount: "154500.00",
	version: null,
	...over,
});

function writesWith(
	book: DeviceWrites["book"],
): DeviceWrites & { refresh: jest.Mock } {
	return {
		book,
		comparePreview: async () => undefined,
		pullsBegun: () => 7,
		storedRebase: async () => null,
		absentSince: async () => false,
		refresh: jest.fn(async () => undefined),
	};
}

const booked = (base: string | null = null) => ({
	bookedAt: 1,
	changes: [
		{
			table: "expenses" as const,
			id: ID,
			before: null,
			after: row({ title: SECRET }) as never,
		},
	],
	changed: [],
	base,
});

const api = {} as RetrospendClient;
const open = () => createOutbox(createMemoryStore(), "scope");

beforeEach(() => {
	forgetUndoTokens();
	mockWrites.mockReset();
});

describe("saveEntry under the device flag", () => {
	it("enqueues the create with the device's booking, no text, and refreshes the engine's view", async () => {
		const outbox = open();
		const writes = writesWith(async () => booked());
		mockWrites.mockReturnValue(writes);
		await saveEntry({ outbox, api, write, waitMs: 0 });
		const [entry] = await outbox.all();
		expect(entry?.device?.changes).toHaveLength(1);
		expect(JSON.stringify(entry?.device)).not.toContain(SECRET);
		expect(writes.refresh).toHaveBeenCalled();
	});

	it("enqueues a plain create when the device could not book it", async () => {
		const outbox = open();
		mockWrites.mockReturnValue(writesWith(async () => null));
		await saveEntry({ outbox, api, write, waitMs: 0 });
		const [entry] = await outbox.all();
		expect(entry?.device).toBeUndefined();
	});

	it("does not book a split expense or any other entity", async () => {
		const outbox = open();
		const book = jest.fn(async () => booked());
		mockWrites.mockReturnValue(writesWith(book));
		await saveEntry({
			outbox,
			api,
			write: { ...write, entity: "shared-expenses" },
			waitMs: 0,
		});
		expect(book).not.toHaveBeenCalled();
	});
});

describe("flush under the device flag", () => {
	it("passes the engine's pullsBegun, so an acked write is retired by a later pull", async () => {
		const outbox = open();
		mockWrites.mockReturnValue(writesWith(async () => booked()));
		const create = async () => ({
			undo: "u",
			expense: { updatedAt: "2026-10-15T15:00:00.000Z" },
		});
		const client = { expenses: { create } } as unknown as RetrospendClient;
		await saveEntry({ outbox, api: client, write });
		expect(await outbox.all()).toEqual([]);
		const [acked] = await outbox.acked();
		expect(acked?.ack).toEqual({
			version: "2026-10-15T15:00:00.000Z",
			pull: 7,
		});
	});
});

describe("queueExpenseChange", () => {
	it("chains an edit after the unsent create for the same row", async () => {
		const outbox = open();
		const writes = writesWith(async () => booked());
		// Enqueued, not saved: a Save also tries one send, which counts as begun.
		await outbox.enqueue({
			clientId: ID,
			entity: "expenses",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: write.body,
		});
		const queued = await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "update", body: { ...write.body, amount: "120" } },
			opened: null,
		});
		expect(queued.status).toBe("queued");
		const all = await outbox.all();
		expect(all[1]).toMatchObject({
			kind: "update",
			targetId: ID,
			baseVersion: { after: ID },
		});
	});

	it("bases a delete of a synced row on the version the screen read, not the booking's", async () => {
		const outbox = open();
		// The booking read another version (a pull moved the store): it is not the base.
		const writes = writesWith(async () => booked("2026-10-06T00:00:00.000Z"));
		await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "delete", id: ID },
			opened: "2026-10-05T03:00:00.000Z",
		});
		const [entry] = await outbox.all();
		expect(entry).toMatchObject({
			kind: "delete",
			baseVersion: "2026-10-05T03:00:00.000Z",
			payload: { id: ID },
		});
	});

	it("falls back to the version the device last pulled when the screen read none", async () => {
		const outbox = open();
		const writes = writesWith(async () => booked("2026-10-05T03:00:00.000Z"));
		const queued = await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "update", body: write.body },
			opened: null,
		});
		expect(queued.status).toBe("queued");
		const [entry] = await outbox.all();
		expect(entry).toMatchObject({ baseVersion: "2026-10-05T03:00:00.000Z" });
	});

	it("is unreadable, queuing nothing, when neither the screen nor the device has a version", async () => {
		const outbox = open();
		for (const book of [async () => booked(null), async () => null]) {
			const queued = await queueExpenseChange({
				outbox,
				writes: writesWith(book),
				change: { kind: "delete", id: ID },
				opened: null,
			});
			expect(queued).toEqual({ status: "unreadable" });
		}
		expect(await outbox.all()).toEqual([]);
	});

	it("still queues, stamped with the screen's version, when the device could not book it", async () => {
		const outbox = open();
		const writes = writesWith(async () => null);
		const queued = await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "update", body: write.body },
			opened: "2026-10-05T03:00:00.000Z",
		});
		expect(queued.status).toBe("queued");
		const [entry] = await outbox.all();
		expect(entry).toMatchObject({ baseVersion: "2026-10-05T03:00:00.000Z" });
		expect(entry?.device).toBeUndefined();
	});

	it("nothing stacks on an entry whose send began", async () => {
		const outbox = open();
		const writes = writesWith(async () => booked());
		mockWrites.mockReturnValue(writes);
		await saveEntry({ outbox, api, write, waitMs: 0 });
		await outbox.markSending(ID);
		const queued = await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "update", body: write.body },
			opened: "v1",
		});
		expect(queued).toEqual({ status: "busy" });
		expect(await outbox.all()).toHaveLength(1);
	});

	it("Undo takes a queued edit back out, since it was never sent", async () => {
		const outbox = open();
		const writes = writesWith(async () => booked("v1"));
		const queued = await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "update", body: write.body },
			opened: "v1",
		});
		if (queued.status !== "queued") throw new Error("not queued");
		expect(await undoSaved({ outbox, api, clientId: queued.clientId })).toBe(
			"undone",
		);
		expect(await outbox.all()).toEqual([]);
	});
});

describe("takeFromOutbox, unsent only", () => {
	it("folds an entry that never began a send, and refuses one that did", async () => {
		const outbox = open();
		mockWrites.mockReturnValue(null);
		await saveEntry({ outbox, api, write, waitMs: 0 });
		await outbox.markSending(ID);
		expect(await takeFromOutbox(outbox, ID, true)).toBeNull();
		expect(await outbox.all()).toHaveLength(1);
		// The flag-off rule is as it was: taken whatever its state.
		expect((await takeFromOutbox(outbox, ID))?.clientId).toBe(ID);
	});
});

describe("the sender sends creates only", () => {
	it("never posts an update or a delete as a create", async () => {
		const outbox = open();
		const create = jest.fn(async () => ({ undo: "u" }));
		const client = { expenses: { create } } as unknown as RetrospendClient;
		const writes = writesWith(async () => booked("v1"));
		await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "update", body: write.body },
			opened: "v1",
		});
		const [entry] = await outbox.all();
		expect(await entryOutbox(outbox).all()).toEqual([]);
		expect(await createEntrySender(client)(entry as never)).toMatchObject({
			status: "retry",
		});
		expect(create).not.toHaveBeenCalled();
	});
});

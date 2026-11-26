import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { forgetUndoTokens, rememberUndo } from "@/features/entry/send";
import {
	EditStillSending,
	templateHasWrites,
	undoTemplateEdit,
} from "./deviceTemplate";

// Undo of a template edit goes by what the outbox says happened to it, not by
// what the sheet was told when it closed (a slow send makes that stale):
// never sent or parked is taken out, sent with no answer is refused and never
// sent again, and one the server took is written back over the template.
jest.mock("@/data/ids", () => ({
	newClientId: () => "00000000-0000-4000-8000-000000000001",
}));

beforeEach(() => forgetUndoTokens());

const STAMP = "2026-10-20T10:00:00.000Z";
const AFTER = "2026-11-02T10:00:05.000Z";

function setup() {
	const outbox = createOutbox(createMemoryStore(), "scope");
	const request = jest.fn();
	const book = jest.fn(async (_op: unknown) => ({
		bookedAt: 1,
		changes: [],
		changed: [],
		base: AFTER as string | null,
	}));
	const device = {
		api: { recurring: { update: request, create: request } },
		outbox,
		writes: { book, refresh: jest.fn(async () => undefined) },
	} as unknown as Parameters<typeof undoTemplateEdit>[0]["device"] & {
		api: RetrospendClient;
	};
	const undo = () =>
		undoTemplateEdit({
			device,
			clientId: "u1",
			id: "t1",
			back: { paused: false },
			title: "Netflix",
		});
	const enqueue = (booked = false) =>
		outbox.enqueue({
			clientId: "u1",
			entity: "recurring",
			kind: "update",
			targetId: "t1",
			baseVersion: STAMP,
			payload: { paused: true, title: "Netflix" },
			...(booked ? { device: { bookedAt: 1, changes: [], changed: [] } } : {}),
		});
	return { outbox, request, book, undo, enqueue };
}

describe("undo of a template edit", () => {
	it("takes an edit that began no send out of the outbox and queues nothing", async () => {
		const { outbox, book, undo, enqueue } = setup();
		await enqueue();
		await undo();
		expect(await outbox.all()).toEqual([]);
		expect(book).not.toHaveBeenCalled();
	});

	it("takes a parked edit out: the server refused it", async () => {
		const { outbox, undo, enqueue } = setup();
		await enqueue();
		await outbox.markSending("u1");
		await outbox.markConflict("u1", "recurring_changed");
		await undo();
		expect(await outbox.all()).toEqual([]);
	});

	it("refuses an edit whose send began and has no answer, and sends nothing", async () => {
		const { outbox, request, book, undo, enqueue } = setup();
		await enqueue();
		await outbox.markSending("u1");
		await expect(undo()).rejects.toBeInstanceOf(EditStillSending);
		// After a network failure the request may still have landed: the same.
		await outbox.markFailed("u1", "offline", "network");
		await expect(undo()).rejects.toBeInstanceOf(EditStillSending);
		const [kept] = await outbox.all();
		expect(kept).toMatchObject({ clientId: "u1", attempts: 1 });
		expect(request).not.toHaveBeenCalled();
		expect(book).not.toHaveBeenCalled();
	});

	const writtenBack = async (
		prove: (s: ReturnType<typeof setup>) => Promise<void>,
	) => {
		const t = setup();
		await prove(t);
		await t.undo();
		expect(t.book).toHaveBeenCalledWith({
			kind: "templateUpdate",
			body: { id: "t1", paused: false },
		});
		const [back] = await t.outbox.all();
		expect(back).toMatchObject({
			kind: "update",
			targetId: "t1",
			baseVersion: AFTER,
			payload: { paused: false, title: "Netflix" },
		});
	};

	it("writes the old values back once the server took the edit (its ack is in the acked list), even when the sheet was told it was queued", () =>
		writtenBack(async ({ outbox, enqueue }) => {
			await enqueue(true);
			await outbox.markSending("u1");
			// The send landed after the sheet gave up waiting.
			await outbox.markSent("u1", { version: AFTER, pull: 1 });
		}));

	it("writes them back on the sender's remembered ack too, for an edit the device did not book", () =>
		writtenBack(async ({ outbox, enqueue }) => {
			await enqueue();
			await outbox.markSending("u1");
			await outbox.markSent("u1", { version: AFTER, pull: 1 });
			rememberUndo("u1", { entity: "recurring", token: "", kind: "update" });
		}));

	it("sends nothing for an edit that was parked and then discarded: it never reached the server, and another device's change stands", async () => {
		const { outbox, request, book, undo, enqueue } = setup();
		await enqueue(true);
		await outbox.markSending("u1");
		await outbox.markConflict("u1", "recurring_changed");
		await outbox.discard("u1");
		await undo();
		expect(book).not.toHaveBeenCalled();
		expect(request).not.toHaveBeenCalled();
		expect(await outbox.all()).toEqual([]);
	});
});

describe("whether a template has writes", () => {
	it("fails closed: no outbox, or one that cannot be read, counts as a write waiting", async () => {
		const outbox = createOutbox(createMemoryStore(), "scope");
		expect(await templateHasWrites(outbox, "t1")).toBe(false);
		expect(await templateHasWrites(null, "t1")).toBe(true);
		jest.spyOn(outbox, "snapshot").mockRejectedValue(new Error("unreadable"));
		expect(await templateHasWrites(outbox, "t1")).toBe(true);
	});
});

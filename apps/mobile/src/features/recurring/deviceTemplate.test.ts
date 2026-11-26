import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { EditStillSending, undoTemplateEdit } from "./deviceTemplate";

// Undo of a template edit goes by what the outbox says happened to it, not by
// what the sheet was told when it closed (a slow send makes that stale):
// never sent or parked is taken out, sent with no answer is refused and never
// sent again, and one the server took is written back over the template.
jest.mock("@/data/ids", () => ({
	newClientId: () => "00000000-0000-4000-8000-000000000001",
}));

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
	const enqueue = () =>
		outbox.enqueue({
			clientId: "u1",
			entity: "recurring",
			kind: "update",
			targetId: "t1",
			baseVersion: STAMP,
			payload: { paused: true, title: "Netflix" },
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

	it("writes the old values back once the server took the edit, even when the sheet was told it was queued", async () => {
		const { outbox, book, undo, enqueue } = setup();
		await enqueue();
		await outbox.markSending("u1");
		// The send landed after the sheet gave up waiting.
		await outbox.markSent("u1", { version: AFTER, pull: 1 });
		await undo();
		expect(book).toHaveBeenCalledWith({
			kind: "templateUpdate",
			body: { id: "t1", paused: false },
		});
		const [back] = await outbox.all();
		expect(back).toMatchObject({
			kind: "update",
			targetId: "t1",
			baseVersion: AFTER,
			payload: { paused: false, title: "Netflix" },
		});
	});
});

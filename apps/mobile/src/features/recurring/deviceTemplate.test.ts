import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { undoTemplateEdit } from "./deviceTemplate";

// Undo of a template edit that never left the phone is taking it out of the
// outbox, not a second write that undoes the first: nothing was sent, so
// there is nothing to write back.
it("takes an edit that began no send out of the outbox and queues nothing", async () => {
	const outbox = createOutbox(createMemoryStore(), "scope");
	await outbox.enqueue({
		clientId: "u1",
		entity: "recurring",
		kind: "update",
		targetId: "t1",
		baseVersion: "2026-10-20T10:00:00.000Z",
		payload: { paused: true, title: "Netflix" },
	});
	const book = jest.fn(async () => null);
	const device = {
		api: { recurring: {} } as unknown as RetrospendClient,
		outbox,
		writes: { book, refresh: jest.fn(async () => undefined) },
	};
	await undoTemplateEdit({
		device: device as never,
		answer: { settled: "queued", clientId: "u1" },
		id: "t1",
		back: { paused: false },
		title: "Netflix",
	});
	expect(await outbox.all()).toEqual([]);
	expect(book).not.toHaveBeenCalled();
});

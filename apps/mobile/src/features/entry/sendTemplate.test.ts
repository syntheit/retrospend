import type { RetrospendClient } from "@retrospend/api-client";
import {
	PROBLEM_STATUS,
	type ProblemCode,
} from "@retrospend/api-contract/errors";
import { createOutbox, type OutboxEntry } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { flushOutbox } from "@/data/sync";
import {
	apiTransport,
	createEntrySender,
	forgetNotFound,
	forgetUndoTokens,
	NO_TOKEN,
	notFoundPull,
	PARKED_NO_STAMP,
	undoFor,
	undoWith,
} from "./send";

// The plain sender for a template create and edit: what goes out (the
// client's id as the template's id, only the fields the edit names, the
// stamp from the chain), how the answers are classified, and where an undo
// of each goes.

const ID = "0b1f6d6e-3c1a-4f1e-9a57-5c1f4d3a2b10";
const EDIT = "9d2c7a1e-8b34-4c55-a1e0-2f6b7c8d9e01";
const STAMP = "2026-11-18T10:00:00.000Z";
const MADE = "2026-12-01T03:05:00.000Z";
const LATER = "2026-12-05T09:00:00.000Z";
const AFTER_EDIT = "2026-12-01T03:06:00.000Z";

const problem = (code: ProblemCode) =>
	Object.assign(new Error(code), { status: PROBLEM_STATUS[code], code });

const BODY = {
	name: "Gym",
	amount: "30",
	currency: "USD",
	frequency: "MONTHLY",
	nextDueDate: "2026-12-15",
	anchorDay: 15,
	autoPay: false,
};

const make = (over: Record<string, unknown> = {}) =>
	({
		clientId: ID,
		entity: "recurring",
		kind: "create",
		targetId: ID,
		baseVersion: null,
		payload: BODY,
		state: "pending",
		attempts: 1,
		networkFailures: 0,
		serverErrors: 0,
		lastError: null,
		createdAt: "",
		...over,
	}) as OutboxEntry;

const edit = (over: Record<string, unknown> = {}) =>
	make({
		clientId: EDIT,
		kind: "update",
		targetId: ID,
		baseVersion: STAMP,
		payload: { paused: true },
		...over,
	});

const templateApi = () => {
	const recurring = {
		create: jest.fn(async () => ({ id: ID, updatedAt: MADE })),
		update: jest.fn(async () => ({ id: ID, updatedAt: AFTER_EDIT })),
		get: jest.fn(async (_input: unknown, _options?: unknown) => ({
			id: ID,
			updatedAt: MADE,
		})),
		delete: jest.fn(async () => ({ ok: true })),
	};
	return { recurring, api: { recurring } as never as RetrospendClient };
};

beforeEach(() => {
	forgetUndoTokens();
	forgetNotFound(ID);
	forgetNotFound(EDIT);
});

describe("sending a template create", () => {
	it("posts the fields under the entry's own id and key, and names the version the server made", async () => {
		const { api, recurring } = templateApi();
		const sent = await createEntrySender(apiTransport(api))(make());
		expect(sent).toEqual({ status: "sent", version: MADE });
		expect(recurring.create).toHaveBeenCalledWith(
			{ ...BODY, id: ID },
			expect.objectContaining({ context: { idempotencyKey: ID } }),
		);
		expect(undoFor(ID)).toEqual({
			entity: "recurring",
			token: NO_TOKEN,
			target: ID,
			kind: "create",
		});
	});

	it("takes the id from the entry, never from a payload that names another", async () => {
		const { api, recurring } = templateApi();
		await createEntrySender(apiTransport(api))(
			make({ payload: { ...BODY, id: "someone-else" } }),
		);
		expect(recurring.create).toHaveBeenCalledWith(
			expect.objectContaining({ id: ID }),
			expect.anything(),
		);
	});

	it("a taken id that is our own template counts as sent, with no version: the read names the template as it is now", async () => {
		const { api, recurring } = templateApi();
		recurring.create.mockRejectedValueOnce(problem("id_taken"));
		recurring.get.mockResolvedValueOnce({ id: ID, updatedAt: LATER });
		expect(await createEntrySender(apiTransport(api))(make())).toEqual({
			status: "sent",
		});
		expect(recurring.get).toHaveBeenCalledWith({ id: ID }, expect.anything());
	});

	it("a taken id that no template of the person's answers to parks and is never counted as sent", async () => {
		const { api, recurring } = templateApi();
		recurring.create.mockRejectedValueOnce(problem("id_taken"));
		recurring.get.mockRejectedValueOnce(problem("not_found"));
		expect(await createEntrySender(apiTransport(api))(make())).toEqual({
			status: "conflict",
			reason: "id_taken",
			http: 409,
		});
	});

	it("a taken id whose read gets no answer waits and tries again", async () => {
		const { api, recurring } = templateApi();
		recurring.create.mockRejectedValueOnce(problem("id_taken"));
		recurring.get.mockRejectedValueOnce(new TypeError("offline"));
		expect(await createEntrySender(apiTransport(api))(make())).toMatchObject({
			status: "retry",
			kind: "network",
		});
	});

	it("an edit chained after a create answered by the read parks as chain_lost and sends nothing: a later web change is never overwritten", async () => {
		const { api, recurring } = templateApi();
		recurring.create.mockRejectedValueOnce(problem("id_taken"));
		// Another device changed the template in the gap: the read is newer than the create.
		recurring.get.mockResolvedValueOnce({ id: ID, updatedAt: LATER });
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue({
			clientId: ID,
			entity: "recurring",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: BODY,
		});
		await outbox.enqueue({
			clientId: EDIT,
			entity: "recurring",
			kind: "update",
			targetId: ID,
			baseVersion: { after: ID },
			payload: { paused: true },
		});
		await flushOutbox(outbox, createEntrySender(apiTransport(api)));
		expect(recurring.update).not.toHaveBeenCalled();
		expect(await outbox.all()).toMatchObject([
			{ clientId: EDIT, state: "conflict", lastError: "chain_lost" },
		]);
	});

	it("a refused body parks with the server's code", async () => {
		const { api, recurring } = templateApi();
		recurring.create.mockRejectedValueOnce(problem("bad_request"));
		expect(await createEntrySender(apiTransport(api))(make())).toMatchObject({
			status: "conflict",
			reason: "bad_request",
		});
	});

	it("no answer keeps it queued", async () => {
		const { api, recurring } = templateApi();
		recurring.create.mockRejectedValueOnce(new TypeError("offline"));
		expect(await createEntrySender(apiTransport(api))(make())).toMatchObject({
			status: "retry",
			kind: "network",
		});
	});
});

describe("sending a template edit", () => {
	it("patches only the named fields with the stamp, under the entry's key", async () => {
		const { api, recurring } = templateApi();
		const sent = await createEntrySender(apiTransport(api))(edit());
		expect(sent).toEqual({ status: "sent", version: AFTER_EDIT });
		expect(recurring.update).toHaveBeenCalledWith(
			{ id: ID, paused: true, expectedUpdatedAt: STAMP },
			expect.objectContaining({ context: { idempotencyKey: EDIT } }),
		);
	});

	it("an edit with no stamp is parked and nothing goes out", async () => {
		const { api, recurring } = templateApi();
		expect(
			await createEntrySender(apiTransport(api))(edit({ baseVersion: null })),
		).toEqual({ status: "conflict", reason: PARKED_NO_STAMP });
		expect(recurring.update).not.toHaveBeenCalled();
	});

	it("a changed template parks with recurring_changed, and notes the pull to resolve it by", async () => {
		const { api, recurring } = templateApi();
		recurring.update.mockRejectedValueOnce(problem("recurring_changed"));
		const sent = await createEntrySender(apiTransport(api), {
			pullsBegun: () => 4,
		})(edit());
		expect(sent).toEqual({
			status: "conflict",
			reason: "recurring_changed",
			http: 409,
		});
		expect(notFoundPull(EDIT)).toBe(4);
	});

	it("a template gone elsewhere parks as not_found and notes the pull", async () => {
		const { api, recurring } = templateApi();
		recurring.update.mockRejectedValueOnce(problem("not_found"));
		const sent = await createEntrySender(apiTransport(api), {
			pullsBegun: () => 6,
		})(edit());
		expect(sent).toMatchObject({ status: "conflict", http: 404 });
		expect(notFoundPull(EDIT)).toBe(6);
	});
});

describe("the stamp chain of a template", () => {
	it("an edit queued behind the create takes the version the create's answer named", async () => {
		const { api, recurring } = templateApi();
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue({
			clientId: ID,
			entity: "recurring",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: BODY,
		});
		await outbox.enqueue({
			clientId: EDIT,
			entity: "recurring",
			kind: "update",
			targetId: ID,
			baseVersion: { after: ID },
			payload: { paused: true },
		});
		const report = await flushOutbox(
			outbox,
			createEntrySender(apiTransport(api)),
		);
		expect(report).toMatchObject({ sent: 2, conflicts: 0 });
		expect(recurring.update).toHaveBeenCalledWith(
			{ id: ID, paused: true, expectedUpdatedAt: MADE },
			expect.anything(),
		);
	});
});

describe("undo of a template write", () => {
	it("a new template is undone by deleting it, under the undo key", async () => {
		const { api, recurring } = templateApi();
		await undoWith(
			apiTransport(api),
			{ entity: "recurring", token: NO_TOKEN, target: ID, kind: "create" },
			ID,
			1,
		);
		expect(recurring.delete).toHaveBeenCalledWith(
			{ id: ID },
			expect.objectContaining({ context: { idempotencyKey: `${ID}-undo-1` } }),
		);
	});

	it("an edit has no server undo: no request goes out", async () => {
		const { api, recurring } = templateApi();
		await expect(
			undoWith(
				apiTransport(api),
				{ entity: "recurring", token: NO_TOKEN, target: ID, kind: "update" },
				EDIT,
			),
		).rejects.toThrow();
		expect(recurring.delete).not.toHaveBeenCalled();
	});
});

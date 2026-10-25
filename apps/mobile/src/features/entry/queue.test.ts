import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { flushOutbox } from "@/data/sync";
import type { PendingWrite } from "./draft";
import { saveEntry, undoSaved } from "./queue";
import { classify, createEntrySender } from "./send";

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";

const coffee: PendingWrite = {
	entity: "shared-expenses",
	label: "Coffee",
	body: {
		id: ID,
		description: "Coffee",
		amount: "12500.00",
		currency: "ARS",
		date: "2026-10-25",
		categoryId: "food",
		paidBy: { type: "user", id: "me1" },
		splitMode: "EQUAL",
		splitWith: [
			{ type: "user", id: "me1" },
			{ type: "user", id: "lucia1" },
		],
	},
};

interface Call {
	route: string;
	input: unknown;
	key: string | undefined;
}

/** A client whose writes answer with an undo token, or fail the way we ask. */
function fakeApi(fail?: () => unknown) {
	const calls: Call[] = [];
	const route =
		(name: string, undo = "tok-1") =>
		async (
			input: unknown,
			options?: { context?: { idempotencyKey?: string } },
		) => {
			calls.push({ route: name, input, key: options?.context?.idempotencyKey });
			const error = fail?.();
			if (error) throw error;
			return { undo };
		};
	const api = {
		expenses: {
			create: route("expenses.create"),
			undo: route("expenses.undo"),
		},
		"shared-expenses": {
			create: route("shared.create"),
			undo: route("shared.undo"),
		},
		income: { create: route("income.create"), undo: route("income.undo") },
	} as unknown as RetrospendClient;
	return { api, calls };
}

const setup = () => createOutbox(createMemoryStore(), "acct");

describe("saveEntry", () => {
	it("writes through the outbox with the client id as the idempotency key", async () => {
		const outbox = setup();
		const { api, calls } = fakeApi();
		const outcome = await saveEntry({ outbox, api, write: coffee });
		expect(outcome).toEqual({
			status: "synced",
			undo: { entity: "shared-expenses", token: "tok-1" },
		});
		expect(calls).toEqual([
			{ route: "shared.create", input: coffee.body, key: ID },
		]);
		// Sent entries leave the outbox.
		expect(await outbox.all()).toEqual([]);
	});

	it("keeps the write on the phone while offline, then sends it on the next flush", async () => {
		const outbox = setup();
		let online = false;
		const { api, calls } = fakeApi(() =>
			online ? null : new TypeError("Network request failed"),
		);
		const outcome = await saveEntry({ outbox, api, write: coffee });
		expect(outcome).toEqual({ status: "queued" });
		const waiting = await outbox.all();
		expect(waiting).toHaveLength(1);
		expect(waiting[0]).toMatchObject({
			clientId: ID,
			entity: "shared-expenses",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: coffee.body,
			state: "failed",
		});

		online = true;
		const report = await flushOutbox(outbox, createEntrySender(api));
		expect(report).toMatchObject({ sent: 1, stopped: false });
		// The retry carries the same key, so the server replays instead of doubling.
		expect(calls.map((c) => c.key)).toEqual([ID, ID]);
		expect(await outbox.all()).toEqual([]);
	});

	it("parks a write the server refuses, never dropping it", async () => {
		const outbox = setup();
		const { api } = fakeApi(() =>
			Object.assign(new Error("bad"), {
				status: 400,
				code: "validation_failed",
			}),
		);
		const outcome = await saveEntry({ outbox, api, write: coffee });
		expect(outcome).toEqual({ status: "parked", reason: "validation_failed" });
		expect(await outbox.all()).toHaveLength(1);
	});

	it("sends earlier writes first and keeps order when one has to wait", async () => {
		const outbox = setup();
		const first = { ...coffee, body: { ...coffee.body, id: "first" } };
		const { api: offline } = fakeApi(() => new TypeError("offline"));
		await saveEntry({ outbox, api: offline, write: first });
		const { api, calls } = fakeApi();
		const outcome = await saveEntry({ outbox, api, write: coffee });
		expect(outcome.status).toBe("synced");
		expect(calls.map((c) => c.key)).toEqual(["first", ID]);
	});
});

describe("undoSaved", () => {
	it("sends a synced write's token to its own undo route", async () => {
		const outbox = setup();
		const { api, calls } = fakeApi();
		const outcome = await saveEntry({ outbox, api, write: coffee });
		expect(await undoSaved({ outbox, api, clientId: ID, outcome })).toBe(
			"undone",
		);
		expect(calls[1]).toEqual({
			route: "shared.undo",
			input: { token: "tok-1" },
			key: `${ID}-undo`,
		});
	});

	it("removes a queued write before anything was sent", async () => {
		const outbox = setup();
		const { api: offline } = fakeApi(() => new TypeError("offline"));
		const outcome = await saveEntry({ outbox, api: offline, write: coffee });
		const { api, calls } = fakeApi();
		expect(await undoSaved({ outbox, api, clientId: ID, outcome })).toBe(
			"undone",
		);
		expect(await outbox.all()).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("says failed when the server cannot take it back", async () => {
		const outbox = setup();
		const { api } = fakeApi();
		const outcome = await saveEntry({ outbox, api, write: coffee });
		const { api: offline } = fakeApi(() => new TypeError("offline"));
		expect(
			await undoSaved({ outbox, api: offline, clientId: ID, outcome }),
		).toBe("failed");
	});
});

describe("classify", () => {
	it("retries what may still work and parks what was refused", () => {
		const status = (n: number, code?: string) => classify({ status: n, code });
		expect(classify(new TypeError("offline")).status).toBe("retry");
		expect(status(401).status).toBe("retry");
		expect(status(429).status).toBe("retry");
		expect(status(503).status).toBe("retry");
		expect(status(409, "idempotency_in_progress").status).toBe("retry");
		// A server error that keeps coming parks the write after three tries.
		expect(classify({ status: 500, code: "internal" }, 2).status).toBe("retry");
		expect(classify({ status: 500, code: "internal" }, 3)).toEqual({
			status: "conflict",
			reason: "internal",
		});
		expect(status(409, "conflict").status).toBe("conflict");
		expect(status(422, "idempotency_key_reused").status).toBe("conflict");
		expect(status(400, "validation_failed")).toEqual({
			status: "conflict",
			reason: "validation_failed",
		});
	});
});

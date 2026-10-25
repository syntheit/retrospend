import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { flushOutbox } from "@/data/sync";
import type { PendingWrite } from "./draft";
import { flushEntries, saveEntry, undoSaved } from "./queue";
import {
	classify,
	createEntrySender,
	entryOutbox,
	forgetUndoTokens,
} from "./send";

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

/**
 * A server that remembers: a create keyed by its idempotency key lands once
 * and replays its answer; an undo removes the row. `behavior` can drop the
 * answer after the row landed (the lost-answer case) or hold the request.
 */
function fakeServer(
	behavior: {
		failFirst?: () => unknown;
		gate?: Promise<void>;
		refuse?: unknown;
	} = {},
) {
	const calls: Call[] = [];
	const rows = new Map<string, string>();
	let first = true;
	const answers = new Map<string, { undo: string }>();
	const create = async (
		input: unknown,
		options?: { context?: { idempotencyKey?: string } },
	) => {
		const key = options?.context?.idempotencyKey;
		calls.push({ route: "create", input, key });
		if (behavior.gate) await behavior.gate;
		if (behavior.refuse) throw behavior.refuse;
		if (key && !answers.has(key)) {
			rows.set(key, "row");
			answers.set(key, { undo: `undo-${key}` });
		}
		if (first && behavior.failFirst) {
			first = false;
			// The row landed, the answer did not.
			throw behavior.failFirst();
		}
		return answers.get(key ?? "") ?? { undo: "undo" };
	};
	const undo = async (
		input: unknown,
		options?: { context?: { idempotencyKey?: string } },
	) => {
		calls.push({
			route: "undo",
			input,
			key: options?.context?.idempotencyKey,
		});
		const token = (input as { token: string }).token;
		rows.delete(token.replace("undo-", ""));
		return {};
	};
	const api = {
		expenses: { create, undo },
		"shared-expenses": { create, undo },
		income: { create, undo },
	} as unknown as RetrospendClient;
	return { api, calls, rows };
}

const setup = () => createOutbox(createMemoryStore(), "acct");
const offline = () => new TypeError("Network request failed");

beforeEach(() => forgetUndoTokens());

describe("saveEntry", () => {
	it("writes through the outbox with the client id as the idempotency key", async () => {
		const outbox = setup();
		const { api, calls } = fakeServer();
		const outcome = await saveEntry({ outbox, api, write: coffee });
		expect(outcome).toEqual({
			status: "synced",
			undo: { entity: "shared-expenses", token: `undo-${ID}` },
		});
		expect(calls).toEqual([{ route: "create", input: coffee.body, key: ID }]);
		expect(await outbox.all()).toEqual([]);
	});

	it("keeps the write on the phone while offline, then sends it on the next flush", async () => {
		const outbox = setup();
		const server = fakeServer({ refuse: offline() });
		expect(await saveEntry({ outbox, api: server.api, write: coffee })).toEqual(
			{ status: "queued" },
		);
		const waiting = await outbox.all();
		expect(waiting).toHaveLength(1);
		expect(waiting[0]).toMatchObject({
			clientId: ID,
			entity: "shared-expenses",
			kind: "create",
			baseVersion: null,
			payload: coffee.body,
			state: "failed",
			attempts: 1,
			networkFailures: 1,
			serverErrors: 0,
		});

		const online = fakeServer();
		const report = await flushEntries(outbox, online.api);
		expect(report).toMatchObject({ sent: 1, stopped: false });
		expect(online.calls.map((c) => c.key)).toEqual([ID]);
		expect(await outbox.all()).toEqual([]);
	});

	it("parks a write the server refuses, never dropping it", async () => {
		const outbox = setup();
		const { api } = fakeServer({
			refuse: Object.assign(new Error("bad"), {
				status: 400,
				code: "validation_failed",
			}),
		});
		expect(await saveEntry({ outbox, api, write: coffee })).toEqual({
			status: "parked",
			reason: "validation_failed",
		});
		expect(await outbox.all()).toHaveLength(1);
	});

	it("gets the undo token even when another flush sent it", async () => {
		const outbox = setup();
		const { api } = fakeServer();
		await outbox.enqueue({
			clientId: ID,
			entity: "shared-expenses",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: coffee.body,
		});
		// A background flush sends it first.
		await flushEntries(outbox, api);
		const outcome = await saveEntry({
			outbox,
			api,
			write: { ...coffee, body: { ...coffee.body, id: "next" } },
		});
		expect(outcome.status).toBe("synced");
	});

	it("does not wait on a send that hangs: it answers queued and the entry stays", async () => {
		const outbox = setup();
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { api } = fakeServer({ gate });
		const outcome = await saveEntry({ outbox, api, write: coffee, waitMs: 5 });
		expect(outcome).toEqual({ status: "queued" });
		expect(await outbox.all()).toHaveLength(1);
		release();
	});

	it("sends earlier writes first and keeps order when one has to wait", async () => {
		const outbox = setup();
		const first = { ...coffee, body: { ...coffee.body, id: "first" } };
		await saveEntry({
			outbox,
			api: fakeServer({ refuse: offline() }).api,
			write: first,
		});
		const server = fakeServer();
		const outcome = await saveEntry({ outbox, api: server.api, write: coffee });
		expect(outcome.status).toBe("synced");
		expect(server.calls.map((c) => c.key)).toEqual(["first", ID]);
	});

	it("treats an id the server already holds as sent", async () => {
		const outbox = setup();
		const taken = Object.assign(new Error("That id or name is already used"), {
			status: 409,
			code: "conflict",
		});
		const { api } = fakeServer({ refuse: taken });
		const outcome = await saveEntry({ outbox, api, write: coffee });
		// Sent, with no token to undo it by.
		expect(outcome).toEqual({ status: "synced", undo: null });
		expect(await outbox.all()).toEqual([]);
	});
});

describe("undoSaved", () => {
	it("sends a synced write's token to the undo route", async () => {
		const outbox = setup();
		const server = fakeServer();
		await saveEntry({ outbox, api: server.api, write: coffee });
		expect(await undoSaved({ outbox, api: server.api, clientId: ID })).toBe(
			"undone",
		);
		expect(server.calls[1]).toEqual({
			route: "undo",
			input: { token: `undo-${ID}` },
			key: `${ID}-undo`,
		});
		expect(server.rows.size).toBe(0);
	});

	it("removes a write that never left the phone", async () => {
		const outbox = setup();
		await outbox.enqueue({
			clientId: ID,
			entity: "shared-expenses",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: coffee.body,
		});
		const { api, calls } = fakeServer();
		expect(await undoSaved({ outbox, api, clientId: ID })).toBe("undone");
		expect(await outbox.all()).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("waits for a send in flight, then undoes it on the server", async () => {
		const outbox = setup();
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const server = fakeServer({ gate });
		// Save gives up waiting and answers queued while the request is out.
		expect(
			await saveEntry({ outbox, api: server.api, write: coffee, waitMs: 5 }),
		).toEqual({ status: "queued" });
		// Undo is tapped now. It must not delete the entry under the request.
		const undone = undoSaved({ outbox, api: server.api, clientId: ID });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(await outbox.all()).toHaveLength(1);
		release();
		expect(await undone).toBe("undone");
		// The server had it, so the server's undo ran and the row is gone.
		expect(server.calls.map((c) => c.route)).toEqual(["create", "undo"]);
		expect(server.rows.size).toBe(0);
		expect(await outbox.all()).toEqual([]);
	});

	it("resends a write whose answer was lost and undoes it on the server", async () => {
		const outbox = setup();
		const server = fakeServer({ failFirst: offline });
		expect(await saveEntry({ outbox, api: server.api, write: coffee })).toEqual(
			{ status: "queued" },
		);
		// The row landed but the phone never heard. It must not be deleted
		// locally: the server would keep an expense the person took back.
		expect(server.rows.size).toBe(1);
		expect(await undoSaved({ outbox, api: server.api, clientId: ID })).toBe(
			"undone",
		);
		expect(server.calls.map((c) => c.route)).toEqual([
			"create",
			"create",
			"undo",
		]);
		// The retry carried the same key, so it replayed instead of writing again.
		expect(server.calls[0]?.key).toBe(ID);
		expect(server.calls[1]?.key).toBe(ID);
		expect(server.rows.size).toBe(0);
		expect(await outbox.all()).toEqual([]);
	});

	it("keeps the write queued and says failed when it can not reach the server", async () => {
		const outbox = setup();
		const server = fakeServer({ failFirst: offline });
		await saveEntry({ outbox, api: server.api, write: coffee });
		const down = fakeServer({ refuse: offline() });
		expect(await undoSaved({ outbox, api: down.api, clientId: ID })).toBe(
			"failed",
		);
		expect(await outbox.all()).toHaveLength(1);
	});

	it("drops a write the server had refused", async () => {
		const outbox = setup();
		const refused = Object.assign(new Error("no"), {
			status: 422,
			code: "missing_rate",
		});
		const server = fakeServer({ refuse: refused });
		await saveEntry({ outbox, api: server.api, write: coffee });
		expect(await undoSaved({ outbox, api: server.api, clientId: ID })).toBe(
			"undone",
		);
		expect(await outbox.all()).toEqual([]);
	});
});

describe("one flush at a time", () => {
	it("runs flushes one after the other", async () => {
		const outbox = setup();
		let open = 0;
		let most = 0;
		const slow = {
			expenses: {
				create: async () => {
					open += 1;
					most = Math.max(most, open);
					await new Promise((resolve) => setTimeout(resolve, 10));
					open -= 1;
					return { undo: "t" };
				},
			},
		} as unknown as RetrospendClient;
		for (const id of ["a", "b"]) {
			await outbox.enqueue({
				clientId: id,
				entity: "expenses",
				kind: "create",
				targetId: id,
				baseVersion: null,
				payload: {},
			});
		}
		await Promise.all([
			flushEntries(outbox, slow),
			flushEntries(outbox, slow),
			flushEntries(outbox, slow),
		]);
		expect(most).toBe(1);
		expect(await outbox.all()).toEqual([]);
	});

	it("stops sending when the run is aborted", async () => {
		const outbox = setup();
		const { api, calls } = fakeServer();
		await outbox.enqueue({
			clientId: ID,
			entity: "expenses",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: {},
		});
		const controller = new AbortController();
		controller.abort();
		const report = await flushOutbox(
			entryOutbox(outbox),
			createEntrySender(api, { signal: controller.signal }),
		);
		expect(report.stopped).toBe(true);
		expect(calls).toEqual([]);
	});
});

describe("classify", () => {
	const status = (n: number, code?: string, serverErrors = 0) =>
		classify({ status: n, code }, serverErrors);

	it("retries what may still work", () => {
		expect(classify(new TypeError("offline"))).toMatchObject({
			status: "retry",
			kind: "network",
		});
		for (const retry of [
			status(401),
			status(408),
			status(429),
			status(403, "missing_scope"),
			status(409, "idempotency_in_progress"),
		]) {
			expect(retry).toMatchObject({ status: "retry", kind: "network" });
		}
		expect(status(503)).toMatchObject({ status: "retry", kind: "server" });
	});

	it("parks what the server refused, a 403 among it", () => {
		expect(status(403, "forbidden")).toEqual({
			status: "conflict",
			reason: "forbidden",
		});
		expect(status(409, "conflict").status).toBe("conflict");
		expect(status(422, "missing_rate").status).toBe("conflict");
		expect(status(400, "validation_failed")).toEqual({
			status: "conflict",
			reason: "validation_failed",
		});
	});

	it("counts only server errors toward parking a write", () => {
		expect(status(500, "internal", 2).status).toBe("retry");
		expect(status(500, "internal", 3)).toEqual({
			status: "conflict",
			reason: "internal",
		});
		// Any number of offline tries never parks it.
		expect(classify(new TypeError("offline"), 99).status).toBe("retry");
	});
});

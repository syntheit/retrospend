import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import type { PendingWrite } from "./draft";
import { flushEntries, saveEntry, undoSaved } from "./queue";
import { apiTransport, classify, forgetUndoTokens } from "./send";

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
 * answer after the row landed (the lost-answer case).
 */
function fakeServer(
	behavior: { failFirst?: () => unknown; refuse?: unknown } = {},
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
		const outcome = await saveEntry({
			outbox,
			api,
			transport: apiTransport(api),
			write: coffee,
		});
		expect(outcome).toEqual({
			status: "synced",
			undo: { entity: "shared-expenses", token: `undo-${ID}`, target: ID },
		});
		expect(calls).toEqual([{ route: "create", input: coffee.body, key: ID }]);
		expect(await outbox.all()).toEqual([]);
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
		await flushEntries(outbox, api, apiTransport(api));
		const outcome = await saveEntry({
			outbox,
			api,
			transport: apiTransport(api),
			write: { ...coffee, body: { ...coffee.body, id: "next" } },
		});
		expect(outcome.status).toBe("synced");
	});

	it("treats an id the server already holds as sent", async () => {
		const outbox = setup();
		const taken = Object.assign(new Error("That id is already used"), {
			status: 409,
			code: "id_taken",
		});
		const { api } = fakeServer({ refuse: taken });
		const outcome = await saveEntry({
			outbox,
			api,
			transport: apiTransport(api),
			write: coffee,
		});
		// Sent, with no token to undo it by.
		expect(outcome).toEqual({ status: "synced", undo: null });
		expect(await outbox.all()).toEqual([]);
	});
});

describe("undoSaved", () => {
	it("sends a synced write's token to the undo route", async () => {
		const outbox = setup();
		const server = fakeServer();
		await saveEntry({
			outbox,
			api: server.api,
			transport: apiTransport(server.api),
			write: coffee,
		});
		expect(
			await undoSaved({
				outbox,
				api: server.api,
				transport: apiTransport(server.api),
				clientId: ID,
			}),
		).toBe("undone");
		expect(server.calls[1]).toEqual({
			route: "undo",
			input: { token: `undo-${ID}` },
			key: `${ID}-undo`,
		});
		expect(server.rows.size).toBe(0);
	});

	it("keeps a write whose replay the server can not give back, and says failed", async () => {
		const outbox = setup();
		const lost = fakeServer({ failFirst: offline });
		await saveEntry({
			outbox,
			api: lost.api,
			transport: apiTransport(lost.api),
			write: coffee,
		});
		// The key's stored answer is gone: the server may well hold the write.
		const gone = fakeServer({
			refuse: Object.assign(new Error("not stored"), {
				status: 409,
				code: "idempotency_replay_unavailable",
			}),
		});
		expect(
			await undoSaved({
				outbox,
				api: gone.api,
				transport: apiTransport(gone.api),
				clientId: ID,
			}),
		).toBe("failed");
		const kept = await outbox.all();
		expect(kept).toHaveLength(1);
		// Parked, so Couldn't sync shows it.
		expect(kept[0]).toMatchObject({
			clientId: ID,
			state: "conflict",
			lastError: "idempotency_replay_unavailable",
		});
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
			http: 403,
		});
		expect(status(409, "conflict").status).toBe("conflict");
		expect(status(422, "missing_rate").status).toBe("conflict");
		expect(status(400, "validation_failed")).toEqual({
			status: "conflict",
			reason: "validation_failed",
			http: 400,
		});
	});

	it("counts only server errors toward parking a write", () => {
		expect(status(500, "internal", 2).status).toBe("retry");
		expect(status(500, "internal", 3)).toEqual({
			status: "conflict",
			reason: "internal",
			http: 500,
		});
		// Any number of offline tries never parks it.
		expect(classify(new TypeError("offline"), 99).status).toBe("retry");
	});
});

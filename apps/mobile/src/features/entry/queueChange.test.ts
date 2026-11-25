import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { bookedRow, booking } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import type { PendingWrite } from "./draft";
import { queueExpenseChange, saveEntry, undoSaved } from "./queue";
import {
	apiTransport,
	forgetUndoTokens,
	KEY_REUSED,
	PARKED_STAMP,
} from "./send";

// Edits under the dev flag, sent: undo routing with generation keys, and what
// a parked row blocks. USD 100 at the blue rate (1,545 ARS).

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const V0 = "2026-10-05T03:00:00.000Z";
const V1 = "2026-10-05T03:00:09.000Z";
const BODY = {
	id: ID,
	title: "Lunch",
	amount: "120",
	currency: "USD",
	date: "2026-10-05",
};
const create: PendingWrite = { entity: "expenses", label: "Lunch", body: BODY };

let mockNextId = 0;
jest.mock("@/data/ids", () => ({ newClientId: () => `id-${++mockNextId}` }));
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));

const rows = booking(
	ID,
	bookedRow(ID, { version: V0 }),
	bookedRow(ID, { amount: "120.00", homeAmount: "185400.00" }),
);

function writesOf(
	over: Partial<DeviceWrites> = {},
): DeviceWrites & { absentSince: jest.Mock } {
	return {
		book: async () => ({ ...rows, base: V0 }),
		comparePreview: async () => undefined,
		pullsBegun: () => 5,
		storedRebase: async () => null,
		absentSince: jest.fn(async () => false),
		refresh: async () => undefined,
		...over,
	} as DeviceWrites & { absentSince: jest.Mock };
}

const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });

/** A server that records each call with its idempotency key. */
function fake(answers: Record<string, () => unknown> = {}) {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const route =
		(name: string, fallback: unknown) =>
		async (
			input: unknown,
			options?: { context?: { idempotencyKey?: string } },
		) => {
			calls.push({ route: name, input, key: options?.context?.idempotencyKey });
			const answer = answers[name];
			return answer ? answer() : fallback;
		};
	const api = {
		expenses: {
			create: route("create", {
				undo: "tok-create",
				expense: { updatedAt: V0 },
			}),
			update: route("update", {
				undo: "tok-update",
				expense: { updatedAt: V1 },
			}),
			delete: route("delete", { id: ID, undo: "tok-delete" }),
			undo: route("undo", { id: ID, redo: "redo" }),
		},
	} as unknown as RetrospendClient;
	return { api, calls };
}

const open = () => createOutbox(createMemoryStore(), "scope");
const edit = (outbox: ReturnType<typeof open>, writes: DeviceWrites) =>
	queueExpenseChange({
		outbox,
		writes,
		change: { kind: "update", body: BODY },
		opened: V0,
	});

beforeEach(() => {
	forgetUndoTokens();
	mockWrites.mockReset();
});

describe("undo of a write that may be on the server", () => {
	const unsent = async (outbox: ReturnType<typeof open>) => {
		await outbox.enqueue({
			clientId: ID,
			entity: "expenses",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: BODY,
		});
		await outbox.markSending(ID);
	};

	it("undo resend answered key reused stays parked", async () => {
		mockWrites.mockReturnValue(null);
		const outbox = open();
		await unsent(outbox);
		const { api } = fake({
			create: () => {
				throw problem(422, KEY_REUSED);
			},
		});
		expect(
			await undoSaved({
				outbox,
				api,
				transport: apiTransport(api),
				clientId: ID,
			}),
		).toBe("failed");
		expect(await outbox.all()).toMatchObject([
			{ state: "conflict", lastError: KEY_REUSED },
		]);
	});

	it("an ordinary 422 on the resend proves it was never stored", async () => {
		mockWrites.mockReturnValue(null);
		const outbox = open();
		await unsent(outbox);
		const { api } = fake({
			create: () => {
				throw problem(422, "bad_request");
			},
		});
		expect(
			await undoSaved({
				outbox,
				api,
				transport: apiTransport(api),
				clientId: ID,
			}),
		).toBe("undone");
		expect(await outbox.all()).toEqual([]);
	});
});

describe("undo under the device flag", () => {
	it("second undo uses a new key", async () => {
		mockWrites.mockReturnValue(writesOf());
		const outbox = open();
		let failNext = true;
		const { api, calls } = fake({
			undo: () => {
				if (failNext) {
					failNext = false;
					throw new Error("offline");
				}
				return { id: ID, redo: "r" };
			},
		});
		await saveEntry({
			outbox,
			api,
			transport: apiTransport(api),
			write: create,
		});
		expect(
			await undoSaved({
				outbox,
				api,
				transport: apiTransport(api),
				clientId: ID,
			}),
		).toBe("failed");
		expect(
			await undoSaved({
				outbox,
				api,
				transport: apiTransport(api),
				clientId: ID,
			}),
		).toBe("undone");
		expect(calls.filter((c) => c.route === "undo").map((c) => c.key)).toEqual([
			`${ID}-undo-1`,
			`${ID}-undo-2`,
		]);
	});
});

describe("undo of a write the lists no longer hold", () => {
	it("is refused when an entry is queued on the row, whatever pulled the acked one out", async () => {
		const writes = writesOf();
		mockWrites.mockReturnValue(writes);
		const outbox = open();
		const { api, calls } = fake();
		await saveEntry({
			outbox,
			api,
			transport: apiTransport(api),
			write: create,
		});
		// A pull brought the row and retired the acked create; then B was queued on it.
		await outbox.retire([ID]);
		expect(await edit(outbox, writes)).toMatchObject({ status: "queued" });
		expect(
			await undoSaved({
				outbox,
				api,
				transport: apiTransport(api),
				clientId: ID,
			}),
		).toBe("failed");
		expect(calls.some((c) => c.route === "undo")).toBe(false);
	});

	it("still undoes when nothing else is about the row", async () => {
		mockWrites.mockReturnValue(writesOf());
		const outbox = open();
		const { api } = fake();
		await saveEntry({
			outbox,
			api,
			transport: apiTransport(api),
			write: create,
		});
		await outbox.retire([ID]);
		expect(
			await undoSaved({
				outbox,
				api,
				transport: apiTransport(api),
				clientId: ID,
			}),
		).toBe("undone");
	});
});

describe("a parked row", () => {
	it("blocks an edit or a delete behind a later entry too, not only when it is the last", async () => {
		const writes = writesOf();
		const outbox = open();
		await outbox.enqueue({
			clientId: "a",
			entity: "expenses",
			kind: "update",
			targetId: ID,
			baseVersion: V0,
			payload: BODY,
		});
		await outbox.enqueue({
			clientId: "b",
			entity: "expenses",
			kind: "update",
			targetId: ID,
			baseVersion: { after: "a" },
			payload: BODY,
		});
		await outbox.markConflict("a", PARKED_STAMP);
		// B is the last for the row and not parked, but A is: C and a delete never stack.
		for (const change of [
			{ kind: "update", body: BODY } as const,
			{ kind: "delete", id: ID } as const,
		]) {
			expect(
				await queueExpenseChange({ outbox, writes, change, opened: V0 }),
			).toEqual({ status: "parked" });
		}
		expect(await outbox.all()).toHaveLength(2);
	});

	it("an edit or delete of it points to Sync issues and queues nothing", async () => {
		const writes = writesOf();
		const outbox = open();
		const first = await outbox.enqueue({
			clientId: "p1",
			entity: "expenses",
			kind: "update",
			targetId: ID,
			baseVersion: V0,
			payload: BODY,
		});
		await outbox.markSending(first.clientId);
		await outbox.markConflict("p1", PARKED_STAMP);
		for (const change of [
			{ kind: "update", body: BODY } as const,
			{ kind: "delete", id: ID } as const,
		]) {
			expect(
				await queueExpenseChange({ outbox, writes, change, opened: V0 }),
			).toEqual({ status: "parked" });
		}
		expect(await outbox.all()).toHaveLength(1);
	});

	it("also when it was parked before any send (a lost chain)", async () => {
		const outbox = open();
		await outbox.enqueue({
			clientId: "p1",
			entity: "expenses",
			kind: "update",
			targetId: ID,
			baseVersion: V0,
			payload: BODY,
		});
		await outbox.markConflict("p1", "chain_lost");
		expect(await edit(outbox, writesOf())).toEqual({ status: "parked" });
	});

	it("a row whose send failed is still only busy", async () => {
		const outbox = open();
		await outbox.enqueue({
			clientId: "p1",
			entity: "expenses",
			kind: "update",
			targetId: ID,
			baseVersion: V0,
			payload: BODY,
		});
		await outbox.markSending("p1");
		await outbox.markFailed("p1", "offline");
		expect(await edit(outbox, writesOf())).toEqual({ status: "busy" });
	});
});

import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { bookedRow, booking } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { parkedFrom } from "./parked-entry";
import { flushEntries, queueExpenseChange } from "./queue";
import { commitRebase, planRebase } from "./rebase";
import { forgetNotFound, forgetUndoTokens, PARKED_STAMP } from "./send";

// A stale stamp of a sent edit or delete under the dev flag, through Sync
// issues. The 404 and the rest of the queue's conflicts are in
// data/sync.contract.test.ts, over every transport.

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
	forgetNotFound("d1");
	mockWrites.mockReset();
});

describe("a stale stamp", () => {
	// The update was acked with no version in its answer, so the replay keeps the
	// pre-edit base (V0) and a delete queued after it is stamped V0. The server
	// has the row at V1: the delete is 409.
	it("a delete after an acked update with no version 409s, parks, and Try again re-bases it", async () => {
		const writes = writesOf({
			storedRebase: async () => ({
				body: { ...BODY, excludeFromAnalytics: false },
				version: V1,
			}),
		});
		mockWrites.mockReturnValue(writes);
		const outbox = open();
		const { api, calls } = fake({
			update: () => ({ undo: "tok-update" }),
			delete: () => {
				throw problem(409, PARKED_STAMP);
			},
		});
		await edit(outbox, writes);
		await flushEntries(outbox, api);
		expect(await outbox.acked()).toHaveLength(1);
		const deleted = await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "delete", id: ID },
			opened: V0,
		});
		if (deleted.status !== "queued") throw new Error("not queued");
		const report = await flushEntries(outbox, api);
		expect(report).toMatchObject({ sent: 0, conflicts: 1 });
		const [parked] = await outbox.all();
		expect(parkedFrom(parked as never)).toMatchObject({
			reason: PARKED_STAMP,
			kind: "delete",
			gone: false,
		});

		// Try again: a new key, checked against the pulled version.
		const plan = await planRebase({
			outbox,
			writes,
			clientId: deleted.clientId,
		});
		if (!plan) throw new Error("no plan");
		const next = await commitRebase({
			outbox,
			writes,
			clientId: deleted.clientId,
			plan,
		});
		expect(next).not.toBe(deleted.clientId);
		api.expenses.delete = jest.fn(async () => ({ id: ID, undo: "t" })) as never;
		await flushEntries(outbox, api);
		expect(api.expenses.delete).toHaveBeenCalledWith(
			{ params: { id: ID }, query: { expectedUpdatedAt: V1 } },
			expect.objectContaining({ context: { idempotencyKey: next } }),
		);
		expect(
			calls
				.filter((c) => c.route === "delete")
				.map((c) => (c.input as { query: unknown }).query),
		).toEqual([{ expectedUpdatedAt: V0 }]);
		expect(await outbox.all()).toEqual([]);
	});
});

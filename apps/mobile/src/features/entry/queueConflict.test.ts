import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { bookedRow, booking } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { parkedFrom } from "./parked-entry";
import { resolveParked } from "./parked-resolve";
import { flushEntries, queueExpenseChange } from "./queue";
import { commitRebase, planRebase } from "./rebase";
import {
	forgetNotFound,
	forgetUndoTokens,
	PARKED_NOT_FOUND,
	PARKED_STAMP,
} from "./send";

// Conflicts of a sent edit or delete under the dev flag: a stale stamp through
// Sync issues and a 404 resolved on absence.

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

describe("a 404 resolves on absence after a later pull", () => {
	const parkedDelete = async (
		outbox: ReturnType<typeof open>,
		writes: DeviceWrites,
		kind: "update" | "delete",
	) => {
		const { api } = fake({
			update: () => {
				throw problem(404, PARKED_NOT_FOUND);
			},
			delete: () => {
				throw problem(404, PARKED_NOT_FOUND);
			},
		});
		const queued = await queueExpenseChange({
			outbox,
			writes,
			change: kind === "delete" ? { kind, id: ID } : { kind, body: BODY },
			opened: V0,
		});
		if (queued.status !== "queued") throw new Error("not queued");
		await flushEntries(outbox, api);
		const entry = (await outbox.all())[0];
		if (!entry) throw new Error("not parked");
		return { api, entry };
	};

	it("404 delete stays parked through a pull begun before it", async () => {
		const writes = writesOf({ pullsBegun: () => 7 });
		mockWrites.mockReturnValue(writes);
		const outbox = open();
		const { api, entry } = await parkedDelete(outbox, writes, "delete");
		// The engine says no pull that began after the 404 has finished.
		const row = await resolveParked(outbox, api, entry);
		expect(row).toMatchObject({ reason: PARKED_NOT_FOUND, gone: false });
		expect(writes.absentSince).toHaveBeenCalledWith(ID, 7);
		expect(await outbox.all()).toHaveLength(1);
	});

	it("retires after a later pull or reset without the row", async () => {
		const writes = writesOf({
			pullsBegun: () => 7,
			absentSince: jest.fn(async () => true),
		});
		mockWrites.mockReturnValue(writes);
		const outbox = open();
		const { api, entry } = await parkedDelete(outbox, writes, "delete");
		expect(await resolveParked(outbox, api, entry)).toBeNull();
		expect(await outbox.all()).toEqual([]);
	});

	it("an edit of a gone row says so and keeps only Discard", async () => {
		const writes = writesOf({
			absentSince: jest.fn(async () => true),
		});
		mockWrites.mockReturnValue(writes);
		const outbox = open();
		const { api, entry } = await parkedDelete(outbox, writes, "update");
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			kind: "update",
			gone: true,
		});
		expect(await outbox.all()).toHaveLength(1);
	});

	it("never resolves a 409, or a 404 of an entry with no flag", async () => {
		const writes = writesOf({ absentSince: jest.fn(async () => true) });
		const outbox = open();
		const { api, entry } = await parkedDelete(outbox, writes, "update");
		mockWrites.mockReturnValue(writes);
		expect(
			await resolveParked(outbox, api, { ...entry, lastError: PARKED_STAMP }),
		).toMatchObject({ gone: false });
		mockWrites.mockReturnValue(null);
		expect(await resolveParked(outbox, api, entry)).toMatchObject({
			gone: false,
		});
	});
});

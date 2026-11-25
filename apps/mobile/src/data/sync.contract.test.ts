import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox, type Outbox } from "@/data/outbox";
import { bookedRow } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { flushOutbox } from "@/data/sync";
import type { PendingWrite } from "@/features/entry/draft";
import { parkedFrom } from "@/features/entry/parked-entry";
import { resolveParked } from "@/features/entry/parked-resolve";
import {
	flushEntries,
	putBackInOutbox,
	queueExpenseChange,
	saveEntry,
	takeFromOutbox,
	undoSaved,
} from "@/features/entry/queue";
import { commitRebase, planRebase } from "@/features/entry/rebase";
import {
	createEntrySender,
	entryOutbox,
	forgetNotFound,
	forgetUndoTokens,
	KEY_REUSED,
	MAYBE_GONE,
	PARKED_STAMP,
} from "@/features/entry/send";
import {
	type Harness,
	plainHarness,
	vaultHarness,
} from "../../test/transportHarness";

// The queue's contract: chains, acks, parking, re-base, undo, the 404 and the
// lost answer behave the same over every transport. The one suite runs over
// API v1 (the plain sender) and over the fake vault sender; a property that
// holds for one and not the other fails here. USD at the blue rate, 1,545 ARS.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const BODY = {
	id: ID,
	title: "Lunch",
	amount: "100",
	currency: "USD",
	date: "2026-10-05",
};
// Hand-derived: 100 x 1,545, 120 x 1,545, 80 x 1,545.
const HOME: Record<string, string> = {
	"100": "154500.00",
	"120": "185400.00",
	"80": "123600.00",
};

let mockNextId = 0;
jest.mock("@/data/ids", () => ({ newClientId: () => `id-${++mockNextId}` }));
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));

/** The device's booking, as far as the queue reads it: the rows, the names changed, the base. */
function writesOf(h: Harness): DeviceWrites {
	return {
		book: async (op) => {
			const row = h.rowOf(
				op.kind === "create"
					? ""
					: op.kind === "delete"
						? op.id
						: String(op.body.id),
			);
			const base = row?.version ?? null;
			if (op.kind === "create") {
				return {
					bookedAt: 1,
					changes: [
						{
							table: "expenses",
							id: ID,
							before: null,
							after: bookedRow(ID) as never,
						},
					],
					changed: [],
					base,
				};
			}
			const id = op.kind === "delete" ? op.id : String(op.body.id);
			const body =
				op.kind === "update"
					? (op.body as unknown as Record<string, unknown>)
					: null;
			const amount = String(body?.amount ?? "100");
			return {
				bookedAt: 1,
				changes: [
					{
						table: "expenses",
						id,
						before: bookedRow(id, { version: base }) as never,
						after: body
							? (bookedRow(id, {
									amount: `${amount}.00`,
									homeAmount: HOME[amount],
								}) as never)
							: null,
					},
				],
				changed: body
					? Object.keys(body).filter(
							(k) => body[k] !== BODY[k as keyof typeof BODY],
						)
					: [],
				base,
			};
		},
		comparePreview: async () => undefined,
		pullsBegun: () => h.pullsBegun(),
		storedRebase: async (id) => {
			const row = h.rowOf(id);
			return row && { body: row.body as never, version: row.version };
		},
		absentSince: jest.fn(async (id: string, since: number) =>
			h.absentSince(id, since),
		),
		refresh: async () => undefined,
	} as DeviceWrites;
}

const lunch = (id: string): PendingWrite => ({
	entity: "expenses",
	label: "Lunch",
	body: { ...BODY, id },
});
const coffee = (id: string): PendingWrite => ({
	entity: "shared-expenses",
	label: "Coffee",
	body: {
		id,
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
});

const harnesses = [
	["plain", plainHarness],
	["vault", vaultHarness],
] as const;

describe.each(harnesses)("the queue over the %s transport", (_name, make) => {
	let h: Harness;
	let outbox: Outbox;
	let writes: DeviceWrites;

	beforeEach(() => {
		h = make();
		outbox = createOutbox(createMemoryStore(), "scope");
		writes = writesOf(h);
		forgetUndoTokens();
		forgetNotFound("id-1");
		mockNextId = 0;
		mockWrites.mockReset();
		mockWrites.mockReturnValue(writes);
	});

	afterEach(() => {
		// A queue that loops sends without end is stopped by the harness and named here.
		expect(h.faults.capped).toBe(false);
	});

	const save = (id = ID, waitMs?: number, write: PendingWrite = lunch(id)) =>
		saveEntry({ outbox, api: h.api, transport: h.transport, write, waitMs });
	const flush = () => flushEntries(outbox, h.api, h.transport);
	const undo = (clientId: string) =>
		undoSaved({ outbox, api: h.api, clientId, transport: h.transport });
	const queue = async (
		change: Parameters<typeof queueExpenseChange>[0]["change"],
		opened: string | null = h.stamp(1),
	) => {
		const queued = await queueExpenseChange({ outbox, writes, change, opened });
		if (queued.status !== "queued")
			throw new Error(`not queued: ${queued.status}`);
		return queued.clientId;
	};
	const retitle = (title: string) =>
		({ kind: "update", body: { ...BODY, title } }) as const;
	const waiting = async () => {
		for (const id of ["a", "b"]) {
			await outbox.enqueue({
				clientId: id,
				entity: "expenses",
				kind: "create",
				targetId: id,
				baseVersion: null,
				payload: { ...BODY, id },
			});
		}
	};

	describe("acks and chains", () => {
		it("a save sends under its client id and waits acked at the version the answer named", async () => {
			expect(await save()).toMatchObject({ status: "synced" });
			expect(h.requests()).toMatchObject([{ key: ID, id: ID, base: null }]);
			expect(await outbox.all()).toEqual([]);
			expect((await outbox.acked())[0]?.ack).toMatchObject({
				version: h.stamp(1),
			});
		});

		it("create, edit, edit in one flush: each send carries the version the one before was acked at", async () => {
			await outbox.enqueue({
				clientId: ID,
				entity: "expenses",
				kind: "create",
				targetId: ID,
				baseVersion: null,
				payload: BODY,
			});
			await queue(retitle("Dinner"), null);
			await queue(retitle("Brunch"), null);
			expect(await flush()).toMatchObject({ sent: 3, conflicts: 0 });
			expect(h.requests().map((r) => r.base)).toEqual([null, 1, 2]);
			expect(h.rowOf(ID)).toMatchObject({ n: 3, body: { title: "Brunch" } });
			expect(await outbox.all()).toEqual([]);
		});

		it("earlier writes go first, and order holds when one has to wait", async () => {
			h.faults.down = true;
			const first = coffee("first");
			expect(await save("first", undefined, first)).toEqual({
				status: "queued",
			});
			expect(h.requests()).toEqual([]);
			expect(await outbox.all()).toMatchObject([
				{
					clientId: "first",
					entity: "shared-expenses",
					kind: "create",
					baseVersion: null,
					payload: first.body,
					state: "failed",
					attempts: 1,
					networkFailures: 1,
					serverErrors: 0,
				},
			]);
			h.faults.down = false;
			expect((await save()).status).toBe("synced");
			expect(h.requests().map((r) => r.key)).toEqual(["first", ID]);
		});

		it("save does not wait on a send that hangs: it answers queued and the entry stays", async () => {
			let release: () => void = () => {};
			h.faults.gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			expect(await save(ID, 5)).toEqual({ status: "queued" });
			expect(await outbox.all()).toHaveLength(1);
			release();
		});

		it("flushes run one after the other", async () => {
			h.faults.delay = 10;
			await waiting();
			await Promise.all([flush(), flush(), flush()]);
			expect(h.faults.most).toBe(1);
			expect(await outbox.all()).toEqual([]);
		});

		it("an aborted run sends nothing and stops", async () => {
			await waiting();
			const controller = new AbortController();
			controller.abort();
			const report = await flushOutbox(
				entryOutbox(outbox),
				createEntrySender(h.transport, { signal: controller.signal }),
			);
			expect(report.stopped).toBe(true);
			expect(h.requests()).toEqual([]);
		});
	});

	describe("refusals park", () => {
		it("a write the server refuses is parked, never dropped", async () => {
			h.faults.refuse = { status: 400, code: "validation_failed", times: 9 };
			expect(await save()).toEqual({
				status: "parked",
				reason: "validation_failed",
			});
			expect(await outbox.all()).toHaveLength(1);
		});

		it("a server that keeps answering 5xx parks the write on the fourth try", async () => {
			h.faults.refuse = { status: 503, code: "unavailable", times: 99 };
			await save();
			for (let i = 0; i < 3; i++) await flush();
			expect(await outbox.all()).toMatchObject([
				{ state: "conflict", lastError: "unavailable" },
			]);
		});

		it("a stale base parks as expense_changed, is never retried, and leaves the row", async () => {
			await save();
			h.elsewhere.edit(ID, { amount: "80" });
			await queue(retitle("Dinner"));
			expect(await flush()).toMatchObject({ sent: 0, conflicts: 1 });
			const [parked] = await outbox.all();
			expect(parkedFrom(parked as never)).toMatchObject({
				reason: PARKED_STAMP,
				kind: "update",
				gone: false,
				retryable: true,
			});
			const sent = h.requests().length;
			await flush();
			expect(h.requests()).toHaveLength(sent);
			expect(h.rowOf(ID)).toMatchObject({ n: 2, body: { amount: "80" } });
		});

		it("an entry behind a parked one for the same row is held, not sent", async () => {
			await save();
			h.elsewhere.edit(ID, { amount: "80" });
			await queue(retitle("Dinner"));
			// Stamped with a version of its own, so only the hold rule keeps it back
			// (a chained one would also park as chain_lost).
			await outbox.enqueue({
				clientId: "behind",
				entity: "expenses",
				kind: "update",
				targetId: ID,
				baseVersion: h.stamp(2),
				payload: { ...BODY, title: "Brunch" },
			});
			await flush();
			// The create and the first edit reached the server; the second never left.
			expect(h.requests()).toHaveLength(2);
			expect(await outbox.all()).toMatchObject([
				{ state: "conflict", lastError: PARKED_STAMP },
				{ clientId: "behind", state: "pending", attempts: 0 },
			]);
		});

		it("a create under a key the server holds for another request parks with Discard only", async () => {
			h.hold(ID);
			expect(await save()).toEqual({ status: "parked", reason: KEY_REUSED });
			const [parked] = await outbox.all();
			expect(parkedFrom(parked as never)).toMatchObject({
				reason: KEY_REUSED,
				retryable: false,
			});
		});
	});

	describe("Try again", () => {
		it("re-bases under a new key on the pulled version and keeps both changes", async () => {
			await save();
			h.elsewhere.edit(ID, { amount: "80" });
			const clientId = await queue(retitle("Dinner"));
			await flush();
			const plan = await planRebase({ outbox, writes, clientId });
			if (!plan) throw new Error("no plan");
			expect(plan.version).toBe(h.stamp(2));
			const next = await commitRebase({ outbox, writes, clientId, plan });
			expect(next).not.toBe(clientId);
			await flush();
			// This phone's title over the other device's amount (USD 80, ARS 123,600.00).
			expect(h.requests().at(-1)).toMatchObject({ key: next, id: ID, base: 2 });
			expect(h.rowOf(ID)).toMatchObject({
				n: 3,
				body: { title: "Dinner", amount: "80" },
			});
			expect(await outbox.all()).toEqual([]);
		});
	});

	describe("a lost answer", () => {
		it("an edit sent again under its key lands once and is acked at the same version", async () => {
			await save();
			const clientId = await queue(retitle("Dinner"));
			h.faults.lose = 1;
			expect(await flush()).toMatchObject({ stopped: true });
			expect(h.rowOf(ID)?.n).toBe(2);
			expect(await flush()).toMatchObject({ sent: 1, stopped: false });
			const sends = h.requests().filter((r) => r.key === clientId);
			expect(sends).toMatchObject([
				{ key: clientId, id: ID, base: 1 },
				{ key: clientId, id: ID, base: 1 },
			]);
			expect(h.rowOf(ID)?.n).toBe(2);
			const acked = await outbox.acked();
			expect(acked.find((e) => e.clientId === clientId)?.ack).toMatchObject({
				version: h.stamp(2),
			});
		});
	});

	describe("a restart", () => {
		it("an edit whose answer was lost goes again from a rebuilt transport with the same bytes, and acks", async () => {
			await save();
			h.pull();
			const clientId = await queue(retitle("Dinner"));
			h.faults.lose = 1;
			expect(await flush()).toMatchObject({ stopped: true });
			h.rebuildTransport();
			expect(await flush()).toMatchObject({ sent: 1, stopped: false });
			const sends = h.requests().filter((r) => r.key === clientId);
			expect(sends).toHaveLength(2);
			expect(sends[1]?.sent).toBe(sends[0]?.sent);
			expect(h.rowOf(ID)).toMatchObject({ n: 2, body: { title: "Dinner" } });
			expect(await outbox.all()).toEqual([]);
		});
	});

	describe("a delete taken back", () => {
		it("a sent create taken out and put back is resent as it was, and acks", async () => {
			h.faults.lose = 1;
			expect(await save()).toEqual({ status: "queued" });
			// The flag off lets a sent entry be taken (the same rule as editing it).
			mockWrites.mockReturnValue(null);
			const taken = await takeFromOutbox(outbox, ID);
			if (!taken) throw new Error("not taken");
			await putBackInOutbox(outbox, taken);
			expect(await flush()).toMatchObject({ sent: 1, conflicts: 0 });
			const sends = h.requests().filter((r) => r.key === ID);
			expect(sends).toHaveLength(2);
			expect(sends[1]?.sent).toBe(sends[0]?.sent);
			expect(h.rowOf(ID)).toMatchObject({ n: 1 });
			expect(await outbox.all()).toEqual([]);
		});
	});

	describe("a delete taken back, then the save undone", () => {
		it("a put-back entry whose send began is undone on the server, not dropped as unsent", async () => {
			h.faults.lose = 1;
			await save();
			mockWrites.mockReturnValue(null);
			const taken = await takeFromOutbox(outbox, ID);
			if (!taken) throw new Error("not taken");
			await putBackInOutbox(outbox, taken);
			// Nothing stacks on it: its send began, so it may be on the server.
			expect(
				await queueExpenseChange({
					outbox,
					writes,
					change: { kind: "update", body: { ...BODY, title: "Dinner" } },
					opened: h.stamp(1),
				}),
			).toEqual({ status: "busy" });
			expect(await undo(ID)).toBe("undone");
			// The resend replayed the first answer, then the undo took the row back.
			expect(h.requests().map((r) => r.key)).toEqual([
				ID,
				ID,
				expect.any(String),
			]);
			expect(h.rowOf(ID)).toBeNull();
			expect(await outbox.all()).toEqual([]);
		});
	});

	describe("a restart, undo", () => {
		it("takes back a create whose answer was lost, from a rebuilt transport", async () => {
			h.faults.lose = 1;
			expect(await save()).toEqual({ status: "queued" });
			h.rebuildTransport();
			expect(await undo(ID)).toBe("undone");
			expect(h.rowOf(ID)).toBeNull();
			expect(await outbox.all()).toEqual([]);
		});
	});

	describe("undo", () => {
		it("removes a write that never left the phone, with no request", async () => {
			await outbox.enqueue({
				clientId: ID,
				entity: "expenses",
				kind: "create",
				targetId: ID,
				baseVersion: null,
				payload: BODY,
			});
			expect(await undo(ID)).toBe("undone");
			expect(await outbox.all()).toEqual([]);
			expect(h.requests()).toEqual([]);
		});

		it("waits for a send in flight, then takes it back on the server", async () => {
			let release: () => void = () => {};
			h.faults.gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			expect(await save(ID, 5)).toEqual({ status: "queued" });
			const undone = undo(ID);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(await outbox.all()).toHaveLength(1);
			release();
			expect(await undone).toBe("undone");
			expect(h.rowOf(ID)).toBeNull();
			expect(await outbox.all()).toEqual([]);
		});

		it("resends a write whose answer was lost, under the same key, and takes it back", async () => {
			h.faults.lose = 1;
			expect(await save()).toEqual({ status: "queued" });
			expect(h.rowOf(ID)?.n).toBe(1);
			expect(await undo(ID)).toBe("undone");
			const keys = h.requests().map((r) => r.key);
			expect(keys.slice(0, 2)).toEqual([ID, ID]);
			expect(keys).toHaveLength(3);
			expect(h.rowOf(ID)).toBeNull();
			expect(await outbox.all()).toEqual([]);
		});

		it("says failed and keeps the write when the server can not be reached", async () => {
			h.faults.lose = 1;
			await save();
			h.faults.down = true;
			expect(await undo(ID)).toBe("failed");
			expect(await outbox.all()).toHaveLength(1);
		});

		it("keeps a write the server keeps answering 5xx for, and says failed", async () => {
			h.faults.lose = 1;
			await save();
			for (let i = 0; i < 3; i++) await outbox.markFailed(ID, "boom", "server");
			h.faults.refuse = { status: 500, code: "internal", times: 99 };
			expect(await undo(ID)).toBe("failed");
			expect(await outbox.all()).toHaveLength(1);
		});

		it("drops a write the server had refused outright", async () => {
			h.faults.refuse = { status: 422, code: "missing_rate", times: 99 };
			await save();
			expect(await undo(ID)).toBe("undone");
			expect(await outbox.all()).toEqual([]);
		});

		it("is refused, with no request, while a later write is about the same row", async () => {
			await save();
			const later = await queue(retitle("Dinner"));
			expect(await undo(ID)).toBe("failed");
			expect(h.requests()).toHaveLength(1);
			// The last one for the row can still be taken back.
			expect(await undo(later)).toBe("undone");
		});

		it("takes a sent edit back on the server and drops its acked record", async () => {
			await save();
			// The device holds the row it edits: undo puts that version back.
			h.pull();
			const edit = await queue(retitle("Dinner"));
			await flush();
			expect(await outbox.acked()).toHaveLength(2);
			expect(await undo(edit)).toBe("undone");
			expect(h.rowOf(ID)).toMatchObject({ n: 3, body: { title: "Lunch" } });
			expect((await outbox.acked()).map((e) => e.clientId)).toEqual([ID]);
		});
	});

	// API v1 answers 404 for a gone row and the vault answers 409 for a gone row
	// and a changed one alike: either way the entry parks, and only a pull that
	// began after the answer and shows the row gone resolves it.
	describe("a parked write resolves on absence after a later pull", () => {
		const parkedAfterGone = async (
			kind: "update" | "delete",
			pullBeforeAnswer = false,
		) => {
			await save();
			// Edited, then deleted: the delete's tombstone is not one version after this phone's base.
			h.elsewhere.edit(ID, { amount: "80" });
			h.elsewhere.remove(ID);
			await queue(kind === "delete" ? { kind, id: ID } : retitle("Dinner"));
			if (pullBeforeAnswer) h.pull();
			await flush();
			const entry = (await outbox.all())[0];
			if (!entry) throw new Error("not parked");
			expect(MAYBE_GONE).toContain(entry.lastError);
			return entry;
		};

		it("a delete stays parked through a pull begun before the answer, and retires after a later one", async () => {
			const entry = await parkedAfterGone("delete", true);
			expect(await resolveParked(outbox, h.api, entry)).toMatchObject({
				reason: entry.lastError,
				gone: false,
			});
			expect(writes.absentSince).toHaveBeenCalledWith(ID, h.pullsBegun());
			expect(await outbox.all()).toHaveLength(1);
			h.pull();
			expect(await resolveParked(outbox, h.api, entry)).toBeNull();
			expect(await outbox.all()).toEqual([]);
		});

		it("a delete is not retired before any pull shows the row gone", async () => {
			const entry = await parkedAfterGone("delete");
			expect(await resolveParked(outbox, h.api, entry)).toMatchObject({
				gone: false,
			});
			expect(await outbox.all()).toHaveLength(1);
		});

		it("an edit of a gone row says so and keeps only Discard", async () => {
			const entry = await parkedAfterGone("update");
			h.pull();
			expect(await resolveParked(outbox, h.api, entry)).toMatchObject({
				kind: "update",
				gone: true,
			});
			expect(await outbox.all()).toHaveLength(1);
		});

		it("a delete with a stale base on a live row parks and is never retired, whatever pulls show", async () => {
			await save();
			h.elsewhere.edit(ID, { amount: "80" });
			await queue({ kind: "delete", id: ID });
			await flush();
			const entry = (await outbox.all())[0];
			expect(entry).toMatchObject({
				state: "conflict",
				lastError: PARKED_STAMP,
			});
			for (const pulled of [false, true]) {
				if (pulled) h.pull();
				expect(
					await resolveParked(outbox, h.api, entry as never),
				).toMatchObject({
					reason: PARKED_STAMP,
					kind: "delete",
					gone: false,
				});
			}
			expect(await outbox.all()).toHaveLength(1);
			expect(h.rowOf(ID)).toMatchObject({ n: 2 });
		});

		it("never resolves an entry with no flag", async () => {
			const entry = await parkedAfterGone("update");
			h.pull();
			mockWrites.mockReturnValue(null);
			expect(await resolveParked(outbox, h.api, entry)).toMatchObject({
				gone: false,
			});
		});
	});
});

describe("the vault sender", () => {
	const open = () => createOutbox(createMemoryStore(), "scope");

	// vault.service.ts:103: a tombstone over a tombstone at the same version is
	// the same bytes, so it answers as applied where API v1 answers 404.
	it("a delete of a row another device deleted at the same version is acked, with no Sync issue", async () => {
		const h = vaultHarness();
		const outbox = open();
		const writes = writesOf(h);
		mockWrites.mockReturnValue(writes);
		await saveEntry({
			outbox,
			api: h.api,
			transport: h.transport,
			write: lunch(ID),
		});
		h.elsewhere.remove(ID);
		await queueExpenseChange({
			outbox,
			writes,
			change: { kind: "delete", id: ID },
			opened: h.stamp(1),
		});
		expect(await flushEntries(outbox, h.api, h.transport)).toMatchObject({
			sent: 1,
			conflicts: 0,
		});
		expect(await outbox.all()).toEqual([]);
		expect(h.rowOf(ID)).toBeNull();
	});

	it("a retry resends identical bytes: sealed once, however often it is sent", async () => {
		const h = vaultHarness();
		const outbox = open();
		mockWrites.mockReturnValue(writesOf(h));
		h.faults.lose = 1;
		await saveEntry({
			outbox,
			api: h.api,
			transport: h.transport,
			write: lunch(ID),
		});
		await flushEntries(outbox, h.api, h.transport);
		const [first, second] = h.requests();
		expect(first?.key).toBe(ID);
		expect(second?.sent).toBe(first?.sent);
		expect(h.seals?.()).toBe(1);
		expect(h.rowOf(ID)).toMatchObject({ n: 1, body: { amount: "100" } });
		expect(await outbox.all()).toEqual([]);
	});

	it("keeps the sealed bytes in the entry before the request leaves, ciphertext only", async () => {
		const h = vaultHarness();
		const outbox = open();
		mockWrites.mockReturnValue(writesOf(h));
		h.faults.down = true;
		await saveEntry({
			outbox,
			api: h.api,
			transport: h.transport,
			write: lunch(ID),
		});
		const [entry] = await outbox.all();
		expect(entry?.sealed).toBeDefined();
		expect(h.requests()).toEqual([]);
		expect(entry?.sealed).not.toContain("Lunch");
	});
});

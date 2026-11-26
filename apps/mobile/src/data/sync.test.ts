import { createOutbox } from "./outbox";
import { confirm, confirmBooking, create, edit } from "./outboxFixtures";
import { createMemoryStore } from "./store";
import { flushOutbox, type Sender, templateAck } from "./sync";

const T0 = "2026-10-15T15:00:00.000Z";
const T1 = "2026-10-15T15:00:01.000Z";
const T2 = "2026-10-15T15:00:02.000Z";

/** Answers each entry with the next version, and records what it was sent. */
function recorder(versions: Record<string, string | null> = {}) {
	const sent: { id: string; base: unknown }[] = [];
	const send: Sender = async (e) => {
		sent.push({ id: e.clientId, base: e.baseVersion });
		return { status: "sent", version: versions[e.clientId] ?? null };
	};
	return { sent, send };
}

describe("flush with chains", () => {
	it("edit, edit, one flush sends the first ack's stamp", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T0));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		const { sent, send } = recorder({ u1: T1, u2: T2 });
		const report = await flushOutbox(outbox, send);
		expect(sent).toEqual([
			{ id: "u1", base: T0 },
			{ id: "u2", base: T1 },
		]);
		expect(report).toEqual({
			sent: 2,
			conflicts: 0,
			retired: 0,
			later: 0,
			stopped: false,
		});
	});

	it("second edit carries the first ack's updatedAt after the first is retired", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			edit("u1", "e1", T0, {
				bookedAt: 1,
				changed: [],
				changes: [{ table: "expenses", id: "e1", before: null, after: null }],
			}),
		);
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		// A send that ends the run after the first ack, as a lost connection would.
		let calls = 0;
		await flushOutbox(outbox, async () =>
			++calls === 1
				? { status: "sent", version: T1 }
				: { status: "retry", reason: "offline" },
		);
		await outbox.retire(["u1"]);
		expect(await outbox.acked()).toEqual([]);
		const { sent, send } = recorder({ u2: T2 });
		await flushOutbox(outbox, send);
		expect(sent).toEqual([{ id: "u2", base: T1 }]);
	});

	it("chain to a missing entry parks chain_lost, sends nothing", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u2", "e1", { after: "gone" }));
		const { sent, send } = recorder();
		const report = await flushOutbox(outbox, send);
		expect(sent).toEqual([]);
		expect(report.conflicts).toBe(1);
		expect((await outbox.all())[0]).toMatchObject({
			state: "conflict",
			lastError: "chain_lost",
			attempts: 0,
		});
	});

	it("entry behind a parked one for the same target is held", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T0));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		await outbox.enqueue(create("e2"));
		await outbox.markConflict("u1", "expense_changed");
		const { sent, send } = recorder();
		await flushOutbox(outbox, send);
		expect(sent.map((s) => s.id)).toEqual(["e2"]);
		expect((await outbox.all()).map((e) => [e.clientId, e.state])).toEqual([
			["u1", "conflict"],
			["u2", "pending"],
		]);
	});

	it("sends the held entry once its predecessor is requeued and acked", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T0));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		await outbox.markConflict("u1", "x");
		await outbox.requeue("u1");
		const { sent, send } = recorder({ u1: T1 });
		await flushOutbox(outbox, send);
		expect(sent).toEqual([
			{ id: "u1", base: T0 },
			{ id: "u2", base: T1 },
		]);
	});

	it("parks an entry chained to a delete, which has no version to give", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue({ ...edit("d1", "e1", T0), kind: "delete" });
		await outbox.enqueue(edit("u2", "e1", { after: "d1" }));
		const { sent, send } = recorder({ d1: null });
		await flushOutbox(outbox, send);
		expect(sent.map((s) => s.id)).toEqual(["d1"]);
		expect((await outbox.all())[0]?.lastError).toBe("chain_lost");
	});

	it("stops at a retry and keeps order", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(edit("u1", "e1", T0));
		await outbox.enqueue(edit("u2", "e1", { after: "u1" }));
		const report = await flushOutbox(outbox, async () => ({
			status: "retry",
			reason: "offline",
		}));
		expect(report.stopped).toBe(true);
		expect((await outbox.all()).map((e) => e.clientId)).toEqual(["u1", "u2"]);
		expect((await outbox.all())[1]?.attempts).toBe(0);
	});

	it("records no pull when no engine count is given, which no pull retires", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			create("e1", {
				bookedAt: 1,
				changed: [],
				changes: [{ table: "expenses", id: "e1", before: null, after: null }],
			}),
		);
		await flushOutbox(outbox, recorder({ e1: T1 }).send);
		expect((await outbox.acked())[0]?.ack.pull).toBe(Number.POSITIVE_INFINITY);
	});

	it("hands the engine's pull count to the ack", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			create("e1", {
				bookedAt: 1,
				changed: [],
				changes: [{ table: "expenses", id: "e1", before: null, after: null }],
			}),
		);
		await flushOutbox(outbox, recorder({ e1: T1 }).send, {
			pullsBegun: () => 4,
		});
		expect((await outbox.acked())[0]?.ack).toEqual({ version: T1, pull: 4 });
	});
});

const ids = async (outbox: ReturnType<typeof createOutbox>) =>
	(await outbox.all()).map((e) => [e.clientId, e.state, e.lastError]);

/** Ends a run that keeps sending, so a broken rule fails a test instead of hanging it. */
const capped =
	(send: Sender, limit = 5): Sender =>
	async (e) => {
		if (--limit < 0) return { status: "retry", reason: "stop" };
		return send(e);
	};

describe("recurring confirm and skip entries", () => {
	it("second poster confirm carries the first ack's templateUpdatedAt", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(
			confirm("c1", "t1", T0, {
				origin: "poster",
				device: confirmBooking("c1", "t1"),
			}),
		);
		await outbox.enqueue(
			confirm("c2", "t1", { after: "c1" }, { origin: "poster" }),
		);
		const sent: unknown[] = [];
		await flushOutbox(outbox, async (e) => {
			sent.push(e.baseVersion);
			return templateAck({
				templateUpdatedAt: e.clientId === "c1" ? T1 : T2,
			});
		});
		expect(sent).toEqual([T0, T1]);
	});

	it("a skip chains behind a confirm of the same template", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(confirm("c1", "t1", T0));
		await outbox.enqueue({
			...confirm("s1", "t1", { after: "c1" }),
			kind: "skip",
		});
		const sent: unknown[] = [];
		await flushOutbox(outbox, async (e) => {
			sent.push([e.kind, e.baseVersion]);
			return templateAck({ templateUpdatedAt: T1 });
		});
		expect(sent).toEqual([
			["confirm", T0],
			["skip", T1],
		]);
	});

	it("retired poster entry drops its run's later entries for the template", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		const poster = { origin: "poster" } as const;
		await outbox.enqueue(confirm("c1", "t1", T0, poster));
		await outbox.enqueue(confirm("c2", "t1", { after: "c1" }, poster));
		await outbox.enqueue(confirm("c3", "t1", { after: "c2" }, poster));
		await outbox.enqueue(confirm("d1", "t2", T0, poster));
		const sent: string[] = [];
		const report = await flushOutbox(
			outbox,
			capped(async (e) => {
				sent.push(e.clientId);
				return e.clientId === "c1"
					? { status: "retired" }
					: { status: "sent", version: T1 };
			}),
		);
		expect(sent).toEqual(["c1", "d1"]);
		expect(report).toMatchObject({ retired: 1, sent: 1, conflicts: 0 });
		expect(await outbox.all()).toEqual([]);
		// No ack, and no Sync issue.
		expect(await outbox.acked()).toEqual([]);
	});

	it("a retired poster entry hands a person's later entry its own base", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(confirm("c1", "t1", T0, { origin: "poster" }));
		await outbox.enqueue(
			confirm("c2", "t1", { after: "c1" }, { origin: "poster" }),
		);
		await outbox.enqueue(confirm("p1", "t1", { after: "c2" }));
		const sent: unknown[] = [];
		await flushOutbox(
			outbox,
			capped(async (e) => {
				sent.push([e.clientId, e.baseVersion]);
				return e.clientId === "c1"
					? { status: "retired" }
					: { status: "sent", version: T1 };
			}),
		);
		expect(sent).toEqual([
			["c1", T0],
			["p1", T0],
		]);
	});

	it("a retired person's entry leaves the later ones, re-pointed to its base", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(confirm("p1", "t1", T0));
		await outbox.enqueue(
			confirm("c1", "t1", { after: "p1" }, { origin: "poster" }),
		);
		const sent: unknown[] = [];
		await flushOutbox(
			outbox,
			capped(async (e) => {
				sent.push([e.clientId, e.baseVersion]);
				return e.clientId === "p1"
					? { status: "retired" }
					: { status: "sent", version: T1 };
			}),
		);
		expect(sent).toEqual([
			["p1", T0],
			["c1", T0],
		]);
	});

	it("recurring_not_due stays pending and the next template's entry is sent", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(confirm("c1", "t1", T0, { origin: "poster" }));
		await outbox.enqueue(confirm("d1", "t2", T0, { origin: "poster" }));
		const sent: string[] = [];
		const report = await flushOutbox(outbox, async (e) => {
			sent.push(e.clientId);
			// A run that sends it again must end, so a broken hold fails instead of hanging.
			if (sent.length > 3) return { status: "retry", reason: "stop" };
			return e.clientId === "c1"
				? { status: "later" }
				: { status: "sent", version: T1 };
		});
		expect(sent).toEqual(["c1", "d1"]);
		expect(report).toMatchObject({ later: 1, sent: 1, stopped: false });
		const [left] = await outbox.all();
		// Waiting, not parked, and nothing held against it.
		expect(left).toMatchObject({
			clientId: "c1",
			state: "pending",
			lastError: null,
			serverErrors: 0,
			networkFailures: 0,
		});
	});

	it("a later entry is not sent twice in one run, nor are the ones behind it", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(confirm("c1", "t1", T0, { origin: "poster" }));
		await outbox.enqueue(
			confirm("c2", "t1", { after: "c1" }, { origin: "poster" }),
		);
		const sent: string[] = [];
		const send: Sender = async (e) => {
			sent.push(e.clientId);
			// A run that sends it again must end, so a broken hold fails instead of hanging.
			return sent.length > 3
				? { status: "retry", reason: "stop" }
				: { status: "later" };
		};
		await flushOutbox(outbox, send);
		expect(sent).toEqual(["c1"]);
		// The hold is for the run only: the next flush tries it again.
		await flushOutbox(outbox, send);
		expect(sent).toEqual(["c1", "c1"]);
		expect(await ids(outbox)).toEqual([
			["c1", "pending", null],
			["c2", "pending", null],
		]);
	});
});

import { createOutbox } from "./outbox";
import { create, edit } from "./outboxFixtures";
import { createMemoryStore } from "./store";
import { flushOutbox, type Sender } from "./sync";

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
		expect(report).toEqual({ sent: 2, conflicts: 0, stopped: false });
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

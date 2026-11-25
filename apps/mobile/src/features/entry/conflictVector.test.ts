import type { RetrospendClient } from "@retrospend/api-client";
import { readDeviceFigures } from "@retrospend/engine";
import { createDeviceEngine } from "@retrospend/engine/device";
import { cursor, expense, fakeDeviceApi } from "@retrospend/engine/device-fake";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { createPendingSource } from "@/data/pendingSource";
import { createMemoryStore } from "@/data/store";
import { flushEntries, queueExpenseChange } from "./queue";
import { commitRebase, planRebase } from "./rebase";
import { PARKED_STAMP } from "./send";

// Two devices edit one expense, on the real device engine, outbox and queue.
// Home is ARS in Buenos Aires, blue is 1545, "now" is 2026-10-15 15:00Z, and
// the expense is USD 100 on Oct 5 booked at blue. Values by hand:
//   USD 100  100 x 1545 = ARS 154,500.00   15,450,000 minor
//   USD  80   80 x 1545 = ARS 123,600.00   12,360,000 minor
//   USD 120  120 x 1545 = ARS 185,400.00   18,540,000 minor
//   80 to 120 moves spent by 61,800.00     6,180,000 minor

let mockNextId = 0;
jest.mock("@/data/ids", () => ({ newClientId: () => `id-${++mockNextId}` }));
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));

const NOW = Date.parse("2026-10-15T15:00:00.000Z");
const V1 = "2026-10-05T03:00:00.000Z";
const V2 = "2026-10-06T10:00:00.000Z";
const V3 = "2026-10-06T10:00:30.000Z";
const rates = {
	asOf: "2026-10-14T09:05:00.000Z",
	rates: [
		{
			id: "r1",
			currency: "ARS",
			type: "blue",
			date: "2026-10-14T00:00:00.000Z",
			unitsPerUsd: "1545",
		},
	],
};
const usd = (
	amount: string,
	home: string,
	over: Record<string, unknown> = {},
) => ({
	...expense("e1", amount, V1),
	currency: "USD",
	amountInUSD: amount,
	exchangeRate: "1",
	rateType: "blue",
	homeRate: "1545",
	homeAmount: home,
	...over,
});
const page = (items: unknown[], at: string) => ({
	items,
	tombstones: [],
	cursor: cursor(at),
	hasMore: false,
});
const edit = (over: Record<string, unknown>) => ({
	id: "e1",
	title: "row",
	amount: "100",
	currency: "USD",
	date: "2026-10-05",
	...over,
});
const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });

/** The device engine over a server whose pulls bring `rows` in turn. */
async function phone(rows: Record<string, unknown>[]) {
	const outbox = createOutbox(createMemoryStore(), "scope");
	const pending = createPendingSource(outbox);
	const { api } = fakeDeviceApi({
		rates,
		expenses: rows.map((r, i) => page([r], `${i + 1}00`)),
		transfers: rows.map((_, i) => page([], `${i + 1}00`)),
	});
	const engine = createDeviceEngine(api, "u1", () => NOW, {
		pending,
		warn: () => undefined,
	});
	await engine.pull();
	const writes: DeviceWrites = {
		book: (op) => engine.book(op),
		comparePreview: async () => undefined,
		pullsBegun: () => engine.pullsBegun,
		storedRebase: (id) => engine.storedRebase(id),
		absentSince: (id, pull) => engine.absentSince(id, pull),
		refresh: () => pending.refresh(),
	};
	mockWrites.mockReturnValue(writes);
	/** Spent as an overlay read gives it, in ARS minor units. */
	const spent = async () => {
		await pending.refresh();
		const lines = await engine.readWithPending(async (view) => {
			const { readings } = await readDeviceFigures(
				view,
				"u1",
				["glance.spent"],
				{},
				() => new Date(NOW),
			);
			return readings.get("glance.spent");
		});
		return lines?.find((l) => l.currency === "ARS")?.minor ?? 0;
	};
	return { outbox, engine, writes, spent };
}

const queue = async (
	p: Awaited<ReturnType<typeof phone>>,
	body: Record<string, unknown>,
) => {
	const queued = await queueExpenseChange({
		outbox: p.outbox,
		writes: p.writes,
		change: { kind: "update", body },
		opened: V1,
	});
	if (queued.status !== "queued") throw new Error(queued.status);
	return queued.clientId;
};

/** A server whose first update is the other device's 409, and whose later ones take the write. */
function server() {
	const sent: {
		id: unknown;
		amount: unknown;
		description: unknown;
		key?: string;
		stamp: unknown;
	}[] = [];
	let first = true;
	const update = async (
		input: Record<string, unknown>,
		options?: { context?: { idempotencyKey?: string } },
	) => {
		sent.push({
			id: input.id,
			amount: input.amount,
			description: input.description,
			key: options?.context?.idempotencyKey,
			stamp: input.expectedUpdatedAt,
		});
		if (first) {
			first = false;
			throw problem(409, PARKED_STAMP);
		}
		return { undo: "tok", expense: { updatedAt: V3 } };
	};
	return { sent, api: { expenses: { update } } as unknown as RetrospendClient };
}

describe("another device's edit under a pending one", () => {
	it("the overlay skips the pending 100 to 120 under the other device's 80, and Try again previews 80 to 120", async () => {
		const p = await phone([
			usd("100", "154500.00"),
			usd("80", "123600.00", { updatedAt: V2 }),
		]);
		const a = await queue(p, edit({ amount: "120" }));
		expect(await p.spent()).toBe(18_540_000);
		await p.engine.pull();
		// The entry expects 100 and the store holds 80: skipped, 123,600.00.
		expect(await p.spent()).toBe(12_360_000);
		const s = server();
		await flushEntries(p.outbox, s.api);
		expect((await p.outbox.all())[0]).toMatchObject({
			clientId: a,
			lastError: PARKED_STAMP,
		});

		const plan = await planRebase({
			outbox: p.outbox,
			writes: p.writes,
			clientId: a,
		});
		if (!plan) throw new Error("no plan");
		expect(plan.version).toBe(V2);
		expect(plan.payload).toMatchObject({ amount: "120" });
		const next = await commitRebase({
			outbox: p.outbox,
			writes: p.writes,
			clientId: a,
			plan,
		});
		expect(next).not.toBeNull();
		// 80 to 120: spent reads 185,400.00, which is +61,800.00 over 123,600.00.
		expect(await p.spent()).toBe(18_540_000);
		expect(18_540_000 - 12_360_000).toBe(6_180_000);
		await flushEntries(p.outbox, s.api);
		expect(s.sent.map((x) => [x.key, x.stamp, x.amount])).toEqual([
			[a, V1, "120"],
			[next, V2, "120"],
		]);
	});

	// Offline: edit A (title) and edit B (note, a full body at amount 100) are queued, B
	// chained after A. The other device sets 80. A is 409, parked, and re-based.
	it("a later edit for the row parks when the first is re-based, and is never sent at amount 100", async () => {
		const p = await phone([
			usd("100", "154500.00"),
			usd("80", "123600.00", { updatedAt: V2 }),
			usd("80", "123600.00", { updatedAt: V3, title: "Lunch" }),
		]);
		const a = await queue(p, edit({ title: "Lunch" }));
		const b = await queue(
			p,
			edit({ title: "Lunch", description: "with Zelda" }),
		);
		await p.engine.pull();
		const s = server();
		await flushEntries(p.outbox, s.api);
		// A was refused; B waits behind it, unsent.
		expect(s.sent).toHaveLength(1);

		const planA = await planRebase({
			outbox: p.outbox,
			writes: p.writes,
			clientId: a,
		});
		if (!planA) throw new Error("no plan");
		await commitRebase({
			outbox: p.outbox,
			writes: p.writes,
			clientId: a,
			plan: planA,
		});
		const all = await p.outbox.all();
		expect(all.find((e) => e.clientId === b)).toMatchObject({
			state: "conflict",
			lastError: PARKED_STAMP,
		});
		await flushEntries(p.outbox, s.api);
		// A's re-based write went out at 80 (the other device's amount); B was not sent at all.
		expect(s.sent).toHaveLength(2);
		expect(s.sent.map((x) => x.description)).toEqual([undefined, undefined]);
		expect(s.sent[1]?.amount).toBe("80");

		// B's own Try again, after a pull brought A's write (v3, amount 80): only the note
		// changes over amount 80, so spent stays 123,600.00.
		await p.engine.pull();
		const planB = await planRebase({
			outbox: p.outbox,
			writes: p.writes,
			clientId: b,
		});
		if (!planB) throw new Error("no plan");
		expect(planB.version).toBe(V3);
		expect(planB.payload).toMatchObject({
			amount: "80",
			description: "with Zelda",
			title: "Lunch",
		});
		await commitRebase({
			outbox: p.outbox,
			writes: p.writes,
			clientId: b,
			plan: planB,
		});
		expect(await p.spent()).toBe(12_360_000);
	});
});

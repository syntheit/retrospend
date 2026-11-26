import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { commitRebase, planRebase, rebasedBody } from "./rebase";
import { PARKED_STAMP } from "./send";

// Try again re-bases a parked edit over the row a pull brought. Rebased bodies
// are the engine's putBodyOf of the pulled row (its own tests hold the day
// and the rate), with this phone's changed fields laid over.

let mockNextId = 0;
jest.mock("@/data/ids", () => ({ newClientId: () => `new-${++mockNextId}` }));

const ID = "e1";
const PULLED_AT = "2026-03-05T02:00:00.000Z";
// The pulled row: another device changed the note and the amount to USD 80.
const pulled = {
	id: ID,
	title: "Taxi",
	amount: "80",
	currency: "USD",
	// 02:00Z on the 5th is the 4th at UTC-3: the zone's day, not the UTC one.
	date: "2026-03-04",
	customRate: "1600",
	description: "Airport, other device's note",
	excludeFromAnalytics: false,
};

describe("rebasedBody", () => {
	it("title-only change re-based over an amount change keeps both", () => {
		const body = rebasedBody(
			pulled,
			{ ...pulled, title: "Taxi home", amount: "120", description: undefined },
			["title"],
		);
		expect(body).toEqual({
			...pulled,
			title: "Taxi home",
			// The other device's USD 80 stays: this phone only changed the title.
			amount: "80",
		});
	});

	it("keeps a typed rate and the zone's day when only the title changed", () => {
		const { description: _note, ...noNote } = pulled;
		expect(rebasedBody(noNote, { ...noNote, title: "Cab" }, ["title"])).toEqual(
			{
				id: ID,
				title: "Cab",
				amount: "80",
				currency: "USD",
				date: "2026-03-04",
				customRate: "1600",
				excludeFromAnalytics: false,
			},
		);
	});

	it("a changed field the payload leaves out is cleared", () => {
		const body = rebasedBody(pulled, { id: ID, title: "Taxi" }, [
			"description",
		]);
		expect(body).not.toHaveProperty("description");
		expect(body.title).toBe("Taxi");
	});

	it("a changed currency takes the payload's whole rate group, never the pulled row's", () => {
		const body = rebasedBody(
			pulled,
			{ id: ID, currency: "EUR", rateType: "official" },
			["currency"],
		);
		expect(body).toMatchObject({ currency: "EUR", rateType: "official" });
		expect(body).not.toHaveProperty("customRate");
		// No rate typed this time: the pulled typed rate is gone too.
		expect(
			rebasedBody(pulled, { id: ID, currency: "EUR" }, ["currency"]),
		).not.toHaveProperty("customRate");
	});
});

const writes = (
	over: Partial<DeviceWrites> = {},
): DeviceWrites & { book: jest.Mock } =>
	({
		book: jest.fn(async () => ({
			bookedAt: 1,
			changes: [],
			changed: ["title"],
			base: PULLED_AT,
		})),
		comparePreview: async () => undefined,
		pullsBegun: () => 1,
		storedRebase: async () => ({ body: pulled, version: PULLED_AT }),
		absentSince: async () => false,
		templateSince: async () => null,
		refresh: async () => undefined,
		...over,
	}) as DeviceWrites & { book: jest.Mock };

const parked = async (outbox: ReturnType<typeof createOutbox>) => {
	await outbox.enqueue({
		clientId: "old",
		entity: "expenses",
		kind: "update",
		targetId: ID,
		baseVersion: "2026-03-01T00:00:00.000Z",
		payload: { ...pulled, title: "Taxi home", amount: "120" },
		device: { bookedAt: 1, changes: [], changed: ["title"] },
	});
	await outbox.markSending("old");
	await outbox.markConflict("old", PARKED_STAMP);
};

describe("planRebase", () => {
	it("plans the pulled version and the body with this phone's title", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await parked(outbox);
		const plan = await planRebase({
			outbox,
			writes: writes(),
			clientId: "old",
		});
		expect(plan).toEqual({
			op: { kind: "update", body: { ...pulled, title: "Taxi home" } },
			version: PULLED_AT,
			payload: { ...pulled, title: "Taxi home" },
		});
	});

	it("is null when the row cannot be read, and for an entry that is not parked", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await parked(outbox);
		const unreadable = writes({ storedRebase: async () => null });
		expect(
			await planRebase({ outbox, writes: unreadable, clientId: "old" }),
		).toBeNull();
		await outbox.requeue("old");
		expect(
			await planRebase({ outbox, writes: writes(), clientId: "old" }),
		).toBeNull();
	});

	it("plans a delete as the id and the pulled version", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await outbox.enqueue({
			clientId: "del",
			entity: "expenses",
			kind: "delete",
			targetId: ID,
			baseVersion: "2026-03-01T00:00:00.000Z",
			payload: { id: ID },
		});
		await outbox.markConflict("del", PARKED_STAMP);
		expect(
			await planRebase({ outbox, writes: writes(), clientId: "del" }),
		).toEqual({
			op: { kind: "delete", id: ID },
			version: PULLED_AT,
			payload: { id: ID },
		});
	});
});

describe("an edit whose changed fields are unknown", () => {
	it("is never re-based: no plan without a device booking", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await outbox.enqueue({
			clientId: "old",
			entity: "expenses",
			kind: "update",
			targetId: ID,
			baseVersion: "2026-03-01T00:00:00.000Z",
			payload: { ...pulled, title: "Taxi home" },
		});
		await outbox.markConflict("old", PARKED_STAMP);
		expect(
			await planRebase({ outbox, writes: writes(), clientId: "old" }),
		).toBeNull();
	});

	it("is not swapped in when the device cannot book the re-based edit", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await parked(outbox);
		const plan = await planRebase({
			outbox,
			writes: writes(),
			clientId: "old",
		});
		if (!plan) throw new Error("no plan");
		const blind = writes({ book: jest.fn(async () => null) });
		expect(
			await commitRebase({ outbox, writes: blind, clientId: "old", plan }),
		).toBeNull();
		expect((await outbox.all()).map((e) => [e.clientId, e.state])).toEqual([
			["old", "conflict"],
		]);
	});
});

describe("commitRebase", () => {
	it("Try again sends a new clientId, same targetId", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await parked(outbox);
		const w = writes();
		const plan = await planRebase({ outbox, writes: w, clientId: "old" });
		if (!plan) throw new Error("no plan");
		const next = await commitRebase({
			outbox,
			writes: w,
			clientId: "old",
			plan,
		});
		expect(next).toMatch(/^new-/);
		const all = await outbox.all();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({
			clientId: next,
			targetId: ID,
			kind: "update",
			baseVersion: PULLED_AT,
			state: "pending",
			attempts: 0,
			payload: plan.payload,
		});
		// The device books the re-based write again, and keeps its booking.
		expect(w.book).toHaveBeenCalledWith(plan.op);
		expect(all[0]?.device).toBeDefined();
	});

	it("re-base parks the later entries for the row, never re-pointing them", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await parked(outbox);
		await outbox.enqueue({
			clientId: "later",
			entity: "expenses",
			kind: "update",
			targetId: ID,
			baseVersion: { after: "old" },
			payload: { id: ID },
		});
		const w = writes();
		const plan = await planRebase({ outbox, writes: w, clientId: "old" });
		if (!plan) throw new Error("no plan");
		await commitRebase({ outbox, writes: w, clientId: "old", plan });
		const later = (await outbox.all()).find((e) => e.clientId === "later");
		expect(later).toMatchObject({
			state: "conflict",
			lastError: PARKED_STAMP,
			baseVersion: { after: "old" },
		});
	});

	it("does nothing for an entry that is not parked any more", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await parked(outbox);
		const w = writes();
		const plan = await planRebase({ outbox, writes: w, clientId: "old" });
		if (!plan) throw new Error("no plan");
		await outbox.requeue("old");
		expect(
			await commitRebase({ outbox, writes: w, clientId: "old", plan }),
		).toBeNull();
		expect((await outbox.all())[0]?.clientId).toBe("old");
	});
});

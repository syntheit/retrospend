import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceEngine, type DeviceEngine } from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import type { PendingEntry, PendingSource } from "./pending";
import type { WriteBody } from "./book";

// The device booking of a save, over the pending writes. Home is ARS in Buenos
// Aires and blue is 1545 (stamped Oct 14 09:05Z). Expected values by hand:
//   USD 100 on Oct 5 at blue: 100 x 1545 = 154,500.00 (ARS home amount)
//   USD 120:                  120 x 1545 = 185,400.00
// A row dated Oct 5 starts at 2026-10-05T03:00Z (UTC-3).
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
const DAY = "2026-10-05T03:00:00.000Z";
const SECRET = "Lunch with Zelda";
const row = (id: string) => ({
	...expense(id, "100", DAY),
	title: SECRET,
	currency: "USD",
	amountInUSD: "100",
	exchangeRate: "1",
	rateType: "blue",
	homeRate: "1545",
	homeAmount: "154500.00",
});
const body = (over: Partial<WriteBody> = {}): WriteBody => ({
	id: "e1",
	title: SECRET,
	amount: "100",
	currency: "USD",
	date: "2026-10-05",
	...over,
});
// Transfers pulled as far as expenses: the device may edit and delete.
const page = (items: unknown[]) => ({
	items,
	tombstones: [],
	cursor: cursor("100"),
	hasMore: false,
});

class Pending implements PendingSource {
	list: PendingEntry[] = [];
	entries = () => this.list;
	retire() {}
	takeLeft = () => [];
}

async function setup(items: unknown[] = [row("e1")]) {
	const pending = new Pending();
	const { api } = fakeDeviceApi({
		rates,
		expenses: [page(items)],
		transfers: [page([])],
	});
	const engine: DeviceEngine = createDeviceEngine(api, "u1", () => 0, {
		pending,
		warn: vi.fn(),
	});
	await engine.pull();
	return { engine, pending };
}

describe("DeviceEngine.book", () => {
	beforeEach(() => vi.useRealTimers());

	it("books a create at blue and keeps no text", async () => {
		const { engine } = await setup([]);
		const booked = await engine.book({ kind: "create", body: body() });
		expect(booked?.unbooked).toBeUndefined();
		expect(booked?.base).toBeNull();
		expect(booked?.changes).toHaveLength(1);
		const after = booked?.changes[0]?.after;
		expect(after?.homeAmount).toBe("154500.00");
		expect(JSON.stringify(booked)).not.toContain(SECRET);
	});

	it("is unbooked, never at 1 or 0, when the device has no rate", async () => {
		const { engine } = await setup([]);
		const booked = await engine.book({
			kind: "create",
			body: body({ currency: "CLP" }),
		});
		expect(booked).toMatchObject({ unbooked: "no_rate", changes: [] });
	});

	it("books an edit with the version it was based on and the names it changed", async () => {
		const { engine } = await setup();
		const booked = await engine.book({
			kind: "update",
			body: body({ amount: "120", title: "Dinner" }),
		});
		expect(booked?.base).toBe(DAY);
		expect(booked?.changed).toEqual(["title", "amount"]);
		expect(booked?.changes[0]?.after?.homeAmount).toBe("185400.00");
		expect(booked?.changes[0]?.before?.homeAmount).toBe("154500.00");
	});

	it("names only the title when only the title changed", async () => {
		const { engine } = await setup();
		const booked = await engine.book({
			kind: "update",
			body: body({ title: "Dinner" }),
		});
		expect(booked?.changed).toEqual(["title"]);
	});

	it("books an edit of a create that is still waiting, over the overlay", async () => {
		const { engine, pending } = await setup([]);
		const create = await engine.book({ kind: "create", body: body() });
		pending.list = [
			{
				clientId: "c1",
				bookedAt: 0,
				changes: create?.changes ?? [],
				changed: [],
				parked: false,
			},
		];
		const edit = await engine.book({
			kind: "update",
			body: body({ amount: "120" }),
		});
		expect(edit?.base).toBeNull();
		expect(edit?.changes[0]?.before?.homeAmount).toBe("154500.00");
		expect(edit?.changes[0]?.after?.homeAmount).toBe("185400.00");
	});

	it("books a delete as the row going away", async () => {
		const { engine } = await setup();
		const booked = await engine.book({ kind: "delete", id: "e1" });
		expect(booked?.changes[0]?.after).toBeNull();
		expect(booked?.base).toBe(DAY);
	});

	it("reads the phone's lists again before a pull begins", async () => {
		const { engine, pending } = await setup();
		const refresh = vi.fn(async () => undefined);
		(pending as PendingSource).refresh = refresh;
		await engine.pull();
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("is null for a row it does not hold, and before the first pull", async () => {
		const { engine } = await setup();
		expect(await engine.book({ kind: "delete", id: "nope" })).toBeNull();
		const { api } = fakeDeviceApi({ rates });
		const fresh = createDeviceEngine(api, "u1", () => 0, { warn: vi.fn() });
		expect(await fresh.book({ kind: "create", body: body() })).toBeNull();
	});
});

import { describe, expect, it, vi } from "vitest";
import type { WriteBody } from "./book";
import { createDeviceEngine } from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import type { PendingEntry, PendingSource } from "./pending";
import type { ServerPreview } from "./preview-compare";

// The device preview held against the server's. Home is ARS in Buenos Aires,
// blue 1545, "now" 2026-10-15 15:00Z. A USD 100 expense on Oct 5 books 154,500.00
// ARS: spent gains USD 100.00 (10,000 minor) and glance.spent gains ARS
// 154,500.00 (15,450,000 minor). Edit to USD 120: 185,400.00, so glance.spent
// moves by 30,900.00 (3,090,000 minor) and spent by USD 20.00 (2,000 minor).
const NOW = Date.parse("2026-10-15T15:00:00.000Z");
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
const saved = {
	...expense("e1", "100", "2026-10-05T03:00:00.000Z"),
	currency: "USD",
	amountInUSD: "100",
	exchangeRate: "1",
	rateType: "blue",
	homeRate: "1545",
	homeAmount: "154500.00",
};
const body = (over: Partial<WriteBody> = {}): WriteBody => ({
	id: "e2",
	title: "Lunch",
	amount: "100",
	currency: "USD",
	date: "2026-10-05",
	...over,
});
const server = (spent: number, glance: number): ServerPreview => ({
	changes: [
		{ id: "spent", currency: "USD", delta: { minor: spent } },
		{ id: "glance.spent", currency: "ARS", delta: { minor: glance } },
	],
	unchanged: [],
	unavailable: [],
});

class Pending implements PendingSource {
	list: PendingEntry[] = [];
	entries = () => this.list;
	retire() {}
	takeLeft = () => [];
}

async function setup() {
	const pending = new Pending();
	const page = (items: unknown[]) => ({
		items,
		tombstones: [],
		cursor: cursor("100"),
		hasMore: false,
	});
	const { api } = fakeDeviceApi({
		rates,
		expenses: [page([saved])],
		transfers: [page([])],
	});
	const engine = createDeviceEngine(api, "u1", () => NOW, {
		pending,
		warn: vi.fn(),
	});
	await engine.pull();
	return { engine, pending };
}

describe("DeviceEngine.comparePreview", () => {
	it("matches when the device and the server move the same figures", async () => {
		const { engine } = await setup();
		const verdict = await engine.comparePreview(
			{ kind: "create", body: body() },
			server(10_000, 15_450_000),
		);
		expect(verdict).toEqual({ id: "e2", outcome: "match" });
		expect(engine.writeParity.counts).toEqual({ "preview:match": 1 });
	});

	it("names the figure that differs, never an amount", async () => {
		const { engine } = await setup();
		const verdict = await engine.comparePreview(
			{ kind: "create", body: body() },
			server(10_000, 15_450_001),
		);
		expect(verdict).toEqual({
			id: "e2",
			outcome: "differs",
			fields: ["glance.spent"],
		});
	});

	it("compares an edit: USD 100 to 120 moves 3,090,000 minor", async () => {
		const { engine } = await setup();
		const verdict = await engine.comparePreview(
			{ kind: "update", body: body({ id: "e1", amount: "120" }) },
			server(2_000, 3_090_000),
		);
		expect(verdict?.outcome).toBe("match");
	});

	it("preview over an unsent entry is pending_ahead", async () => {
		const { engine, pending } = await setup();
		pending.list = [
			{
				clientId: "c1",
				entity: "expenses",
				targetId: "x",
				payload: {},
				bookedAt: NOW,
				changes: [{ table: "expenses", id: "e1", before: null, after: null }],
				changed: [],
				parked: false,
			},
		];
		const verdict = await engine.comparePreview(
			{ kind: "update", body: body({ id: "e1", amount: "120" }) },
			// A server that has not seen the unsent entry reads a different base.
			server(9, 9),
		);
		expect(verdict).toEqual({
			id: "e1",
			outcome: "skipped",
			code: "pending_ahead",
		});
	});

	it("is rate_missing, never a rate of 1, when the device lacks the server's rate", async () => {
		const { engine } = await setup();
		const verdict = await engine.comparePreview(
			{ kind: "create", body: body({ currency: "CLP" }) },
			server(1, 1),
		);
		expect(verdict).toEqual({ id: "e2", outcome: "rate_missing" });
	});
});

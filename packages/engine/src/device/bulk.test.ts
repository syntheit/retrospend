import { describe, expect, it, vi } from "vitest";
import { createDeviceEngine } from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import type { PendingEntry, PendingSource } from "./pending";
import type { ServerPreview } from "./preview-compare";

// Bulk categorize and delete on the device. ARS home, blue 1545, "now"
// 2026-10-15 15:00Z. Rows: a is USD 10 (ARS 15,450.00), b is an income row, c
// is USD 30.01 and the fee of transfer t1. A delete of a moves spent by USD
// -10.00 (-1,000 minor) and glance.spent by ARS -15,450.00 (-1,545,000 minor).
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
const usd = (id: string, amount: string, home: string) => ({
	...expense(id, amount, "2026-10-05T03:00:00.000Z"),
	currency: "USD",
	amountInUSD: amount,
	exchangeRate: "1",
	homeRate: "1545",
	homeAmount: home,
});
const A = usd("a", "10", "15450.00");
const B = { ...usd("b", "20", "30900.00"), direction: "IN" };
const C = usd("c", "30.01", "46365.45");
const category = (id: string, excludeByDefault: boolean) => ({
	id,
	name: id,
	color: "teal",
	icon: null,
	isFixed: false,
	excludeByDefault,
	kind: "EXPENSE",
});
const feeOfC = {
	id: "t1",
	kind: "TRANSFER",
	date: "2026-10-05T03:00:00.000Z",
	fromAccountId: null,
	fromAmount: "30.01",
	fromCurrency: "USD",
	toAccountId: null,
	toAmount: "0",
	toCurrency: "USD",
	referenceRateType: null,
	feeExpenseId: "c",
	countedFromUnits: "0",
	countedToUnits: "0",
	note: null,
	createdAt: "2026-10-05T03:00:00.000Z",
};
const page = (items: unknown[], tombstones: { id: string }[] = []) => ({
	items,
	tombstones,
	cursor: cursor("100"),
	hasMore: false,
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

/** `later` is what the next pull brings. */
async function setup(later: { items?: unknown[]; gone?: string[] } = {}) {
	const pending = new Pending();
	const { api } = fakeDeviceApi({
		rates,
		expenses: [
			page([A, B, C]),
			page(
				later.items ?? [],
				(later.gone ?? []).map((id) => ({ id })),
			),
		],
		categories: [page([category("food", false), category("hold", true)])],
		transfers: [page([feeOfC])],
	});
	const engine = createDeviceEngine(api, "u1", () => NOW, {
		pending,
		warn: vi.fn(),
	});
	await engine.pull();
	return { engine, pending };
}

const deleteAll = {
	kind: "deleteMany",
	ids: ["a", "b", "c", "ghost"],
} as const;
const toHold = {
	kind: "categorize",
	categoryId: "hold",
	ids: ["a", "b", "c"],
} as const;

describe("DeviceEngine.bookBulk", () => {
	it("a categorize takes a, skips the income row and the fee, and applies the category default", async () => {
		const { engine } = await setup();
		const booked = await engine.bookBulk(toHold);
		expect(booked?.reached).toBe(1);
		expect(booked?.skipped).toEqual([
			{ id: "b", reason: "notFound" },
			{ id: "c", reason: "hasLegs" },
		]);
		expect(booked?.changes).toHaveLength(1);
		const [change] = booked?.changes ?? [];
		expect(change?.before).toMatchObject({
			id: "a",
			categoryId: null,
			excludeFromAnalytics: false,
		});
		expect(change?.after).toMatchObject({
			id: "a",
			categoryId: "hold",
			excludeFromAnalytics: true,
		});
	});

	it("a delete takes a and names why it left the rest", async () => {
		const { engine } = await setup();
		const booked = await engine.bookBulk(deleteAll);
		expect(booked?.reached).toBe(1);
		expect(booked?.skipped).toEqual([
			{ id: "b", reason: "notFound" },
			{ id: "c", reason: "hasLegs" },
			{ id: "ghost", reason: "notFound" },
		]);
		expect(booked?.changes.map((c) => [c.id, c.after])).toEqual([["a", null]]);
	});

	it("is null when nothing can go, so the server decides", async () => {
		const { engine } = await setup();
		expect(
			await engine.bookBulk({ kind: "deleteMany", ids: ["ghost"] }),
		).toBeNull();
	});
});

describe("DeviceEngine.comparePreviewBulk", () => {
	it("matches when the device and the server take USD 10 and ARS 15,450.00 out of spent", async () => {
		const { engine } = await setup();
		const verdict = await engine.comparePreviewBulk(
			deleteAll,
			server(-1_000, -1_545_000),
		);
		expect(verdict).toEqual({ id: "a", outcome: "match" });
	});

	it("names the figure that differs, never an amount", async () => {
		const { engine } = await setup();
		const verdict = await engine.comparePreviewBulk(
			deleteAll,
			server(-1_000, -1_545_001),
		);
		expect(verdict).toEqual({
			id: "a",
			outcome: "differs",
			fields: ["glance.spent"],
		});
	});

	it("bulk preview over an unsent entry is pending_ahead", async () => {
		const { engine, pending } = await setup();
		pending.list = [
			{
				clientId: "c1",
				bookedAt: NOW,
				changes: [{ table: "expenses", id: "c", before: null, after: null }],
				changed: [],
				parked: false,
			},
		];
		const verdict = await engine.comparePreviewBulk(deleteAll, server(9, 9));
		expect(verdict).toEqual({
			id: "a",
			outcome: "skipped",
			code: "pending_ahead",
		});
		expect(engine.writeParity.counts).toEqual({
			"preview:skipped:pending_ahead": 1,
		});
	});
});

describe("DeviceEngine.settleBulk", () => {
	it("retires the rows both sides left alone as gone_already or refused", async () => {
		const { engine } = await setup();
		const booked = await engine.bookBulk(deleteAll);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 1, skipped: ["b", "c", "ghost"] },
			deleteAll.ids,
		);
		expect(engine.writeParity.counts).toEqual({
			"skipped:gone_already": 2,
			"skipped:refused": 1,
		});
	});

	it("a row the server skipped and the device took is a difference, by id and field name", async () => {
		const { engine } = await setup();
		const booked = await engine.bookBulk(deleteAll);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 0, skipped: ["a", "b", "c", "ghost"] },
			deleteAll.ids,
		);
		expect(engine.writeParity.recent).toContainEqual({
			id: "a",
			outcome: "differs",
			fields: ["skipped"],
		});
	});

	it("a categorize count that differs is held on the first pick", async () => {
		const { engine } = await setup();
		const booked = await engine.bookBulk(toHold);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 2, skipped: null },
			toHold.ids,
		);
		expect(engine.writeParity.recent).toContainEqual({
			id: "a",
			outcome: "differs",
			fields: ["reached"],
		});
	});

	it("a delete the next pull shows (a is a tombstone) matches", async () => {
		const { engine } = await setup({ gone: ["a"] });
		const booked = await engine.bookBulk(deleteAll);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 1, skipped: ["b", "c", "ghost"] },
			deleteAll.ids,
		);
		await engine.pull();
		expect(engine.writeParity.counts.match).toBe(1);
	});

	it("a delete the next pull does not show is a difference named deleted", async () => {
		const { engine } = await setup();
		const booked = await engine.bookBulk(deleteAll);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 1, skipped: ["b", "c", "ghost"] },
			deleteAll.ids,
		);
		await engine.pull();
		expect(engine.writeParity.recent).toContainEqual({
			id: "a",
			outcome: "differs",
			fields: ["deleted"],
		});
	});

	it("a categorize the next pull shows matches", async () => {
		const row = { ...A, categoryId: "hold", excludeFromAnalytics: true };
		const { engine } = await setup({ items: [row] });
		const booked = await engine.bookBulk(toHold);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 1, skipped: null },
			toHold.ids,
		);
		await engine.pull();
		expect(engine.writeParity.counts.match).toBe(1);
	});

	it("a row edited elsewhere since is a skip, not a difference", async () => {
		const row = {
			...usd("a", "12", "18540.00"),
			categoryId: "hold",
			excludeFromAnalytics: true,
		};
		const { engine } = await setup({ items: [row] });
		const booked = await engine.bookBulk(toHold);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 1, skipped: null },
			toHold.ids,
		);
		await engine.pull();
		expect(engine.writeParity.counts["skipped:changed_since"]).toBe(1);
		expect(engine.writeParity.counts.differs).toBeUndefined();
	});

	it("a categorize the pull shows in another category is a difference", async () => {
		const row = { ...A, categoryId: "food", excludeFromAnalytics: true };
		const { engine } = await setup({ items: [row] });
		const booked = await engine.bookBulk(toHold);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 1, skipped: null },
			toHold.ids,
		);
		await engine.pull();
		expect(engine.writeParity.recent).toContainEqual({
			id: "a",
			outcome: "differs",
			fields: ["categoryId"],
		});
	});

	it("an undone bulk action is skipped as undone and never compared", async () => {
		const { engine } = await setup();
		const booked = await engine.bookBulk(deleteAll);
		engine.settleBulk(
			"k1",
			booked as NonNullable<typeof booked>,
			{ reached: 1, skipped: ["b", "c", "ghost"] },
			deleteAll.ids,
		);
		engine.undoneBulk("k1");
		await engine.pull();
		expect(engine.writeParity.counts["skipped:undone"]).toBe(1);
		expect(engine.writeParity.counts.differs).toBeUndefined();
		expect(engine.writeParity.counts.match).toBeUndefined();
	});
});

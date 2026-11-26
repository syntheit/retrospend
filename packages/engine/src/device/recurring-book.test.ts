import { describe, expect, it, vi } from "vitest";
import type { WriteOp } from "./book";
import { createDeviceEngine } from "./engine";
import { cursor, fakeDeviceApi, template } from "./fake-api";
import type {
	ExpenseChange,
	PendingEntry,
	PendingSource,
	TemplateChange,
} from "./pending";
import type { ServerPreview } from "./preview-compare";

// A person's confirm or skip booked on the device, and its preview held
// against the server's. Home is ARS in Buenos Aires (UTC-3), blue 1,545 from
// Dec 1, "now" 2026-12-01T03:05Z. The template is USD 20 monthly due
// 2026-12-01T03:00Z (the start of Dec 1 there). By hand:
//   a confirm books ARS 20 x 1,545 = 30,900.00 and steps the template to
//   2027-01-01T03:00Z; spent gains USD 20.00 (2,000 minor) and glance.spent
//   ARS 30,900.00 (3,090,000 minor). A skip moves no figure.
const NOW = Date.parse("2026-12-01T03:05:00.000Z");
const DUE = "2026-12-01T03:00:00.000Z";
const rates = {
	asOf: "2026-12-01T00:00:00.000Z",
	rates: [
		{
			id: "r1",
			currency: "ARS",
			type: "blue",
			date: "2026-12-01T00:00:00.000Z",
			unitsPerUsd: "1545",
		},
	],
};
const page = (items: unknown[]) => ({
	items,
	tombstones: [],
	cursor: cursor("100"),
	hasMore: false,
});
const confirm = (over: Record<string, unknown> = {}): WriteOp => ({
	kind: "confirm",
	body: { templateId: "t1", dueAt: DUE, expenseId: "e1", ...over },
});
const skip: WriteOp = { kind: "skip", body: { templateId: "t1", dueAt: DUE } };
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

async function setup(row = template("t1")) {
	const pending = new Pending();
	const { api } = fakeDeviceApi({
		rates,
		expenses: [page([])],
		transfers: [page([])],
		templates: [page([row])],
	});
	const engine = createDeviceEngine(api, "u1", () => NOW, {
		pending,
		warn: vi.fn(),
	});
	await engine.pull();
	return { engine, pending };
}

describe("DeviceEngine.book of a recurring confirm or skip", () => {
	it("books the posted expense and the template one period on, with the pulled version and no text", async () => {
		const { engine } = await setup();
		const booked = await engine.book(confirm());
		expect(booked?.base).toBe("2026-11-18T10:00:00.000Z");
		const [posted, moved] = booked?.changes ?? [];
		expect(posted).toMatchObject({ table: "expenses", id: "e1", before: null });
		expect((posted as ExpenseChange).after).toMatchObject({
			homeAmount: "30900.00",
			recurringTemplateId: "t1",
		});
		expect(moved).toMatchObject({ table: "recurringTemplates", id: "t1" });
		expect((moved as TemplateChange).after?.nextDueDate.toISOString()).toBe(
			"2027-01-01T03:00:00.000Z",
		);
		expect(JSON.stringify(booked)).not.toContain("Rent");
	});

	it("books a skip as the template alone one period on", async () => {
		const { engine } = await setup();
		const booked = await engine.book(skip);
		expect(booked?.changes.map((c) => c.table)).toEqual(["recurringTemplates"]);
	});

	it("books a varying amount and a paid-on day at that day's rate", async () => {
		const { engine } = await setup(template("t1", { amountMode: "ASK" }));
		const booked = await engine.book(
			confirm({ amount: "18.50", paidOn: "2026-12-01" }),
		);
		// 18.50 x 1,545 = 28,582.50.
		expect(
			(booked?.changes[0] as ExpenseChange | undefined)?.after?.homeAmount,
		).toBe("28582.50");
	});

	it("is unbooked, never at 1 or 0, when the currency has no rate", async () => {
		const { engine } = await setup(template("t1", { currency: "CLP" }));
		expect(await engine.book(confirm())).toMatchObject({
			unbooked: "no_rate",
			changes: [],
		});
	});

	it("is null, a refusal the server decides, for a period already posted, a paused template and an amount a fixed one refuses", async () => {
		const { engine } = await setup();
		expect(
			await engine.book(confirm({ dueAt: "2026-11-01T03:00:00.000Z" })),
		).toBeNull();
		expect(await engine.book(confirm({ amount: "5" }))).toBeNull();
		const paused = await setup(template("t1", { isActive: false }));
		expect(await paused.engine.book(confirm())).toBeNull();
		expect(await paused.engine.book(skip)).toBeNull();
	});

	it("is null for recurring income, which stays online", async () => {
		const { engine } = await setup(template("t1", { direction: "IN" }));
		expect(await engine.book(confirm())).toBeNull();
		expect(await engine.book(skip)).toBeNull();
	});
});

describe("DeviceEngine.comparePreview of a recurring confirm or skip", () => {
	it("matches when the device and the server move the same figures, and names the one that differs", async () => {
		const { engine } = await setup();
		expect(
			await engine.comparePreview(confirm(), server(2000, 3_090_000)),
		).toEqual({
			id: "t1",
			outcome: "match",
		});
		expect(
			await engine.comparePreview(confirm(), server(2000, 3_090_001)),
		).toEqual({
			id: "t1",
			outcome: "differs",
			fields: ["glance.spent"],
		});
	});

	it("holds a skip against a server preview that moves nothing", async () => {
		const { engine } = await setup();
		expect(
			await engine.comparePreview(skip, {
				changes: [],
				unchanged: [],
				unavailable: [],
			}),
		).toEqual({ id: "t1", outcome: "match" });
	});

	it("is pending_ahead while an unsent entry changed the template, and refused for a period it cannot post", async () => {
		const { engine, pending } = await setup();
		const first = await engine.book(confirm());
		pending.list = [
			{
				clientId: "c1",
				bookedAt: NOW,
				changes: first?.changes ?? [],
				changed: [],
				parked: false,
			},
		];
		expect(await engine.comparePreview(skip, server(0, 0))).toEqual({
			id: "t1",
			outcome: "skipped",
			code: "pending_ahead",
		});
		const clean = await setup();
		expect(
			await clean.engine.comparePreview(
				confirm({ dueAt: "2026-11-01T03:00:00.000Z" }),
				server(2000, 3_090_000),
			),
		).toEqual({ id: "t1", outcome: "refused" });
	});
});

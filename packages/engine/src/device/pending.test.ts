import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ExpenseRow, withoutText } from "../expenses";
import { readDeviceFigures } from "../registry";
import { createDeviceEngine, type DeviceEngine } from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import type { PendingChange, PendingEntry, PendingSource } from "./pending";
import type { FigureBasis } from "./ports";

// The overlay and the write compare on the device engine. Home is ARS in
// Buenos Aires, blue is 1545 (stamped Oct 14 09:05Z, before every booking
// here), "now" is 2026-10-15 15:00Z. The figure is glance.spent. Every row is USD 100 on Oct 5 booked at
// blue: 100 x 1545 = ARS 154,500.00, which is 15,450,000 minor. Expected
// values below are derived by hand from that:
//   create of a second USD 100        +154,500.00 -> 309,000.00
//   edit to USD 120      120 x 1545 =  185,400.00
//   edit to USD 130      130 x 1545 =  200,850.00
//   another device's USD 80  80 x 1545 =  123,600.00
const NOW = new Date("2026-10-15T15:00:00.000Z");
const BOOKED_AT = NOW.getTime() - 60_000;
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
const booked = (id: string, over: Record<string, unknown> = {}) => ({
	...expense(id, "100", DAY),
	currency: "USD",
	amountInUSD: "100",
	exchangeRate: "1",
	rateType: "blue",
	homeRate: "1545",
	homeAmount: "154500.00",
	...over,
});
const page = (
	items: unknown[],
	at = "c1",
	tombstones: { id: string }[] = [],
) => ({
	items,
	tombstones,
	cursor: at,
	hasMore: false,
});

const AMOUNT_120 = {
	amount: "120",
	amountInUSD: "120",
	homeAmount: "185400.00",
};
const AMOUNT_130 = {
	amount: "130",
	amountInUSD: "130",
	homeAmount: "200850.00",
};
const HOME_ARS = (minor: number) => [{ minor, currency: "ARS" }];

/** The phone's lists as a fake: what it holds, what a pull retired, what left. */
class FakePending implements PendingSource {
	list: PendingEntry[] = [];
	retired: string[] = [];
	left: ReturnType<PendingSource["takeLeft"]> = [];
	/** A list that never retires what it is told to, as a bug in the phone would. */
	forgetful = false;
	entries = () => this.list;
	retire(ids: readonly string[]) {
		this.retired.push(...ids);
		if (!this.forgetful)
			this.list = this.list.filter((e) => !ids.includes(e.clientId));
	}
	takeLeft() {
		const left = this.left;
		this.left = [];
		return left;
	}
}

const warn = vi.fn<(what: string, detail?: string) => void>();
const FIGURES_NOW = () => NOW;

function setup(pages: ReturnType<typeof page>[]) {
	const pending = new FakePending();
	const { api } = fakeDeviceApi({ rates, expenses: pages });
	const engine = createDeviceEngine(api, "u1", Date.now, { warn, pending });
	return { engine, pending };
}

/** Spent as an overlay read gives it, in ARS minor units. */
async function spentOf(engine: DeviceEngine) {
	const lines = await engine.readWithPending(async (view) => {
		const { readings } = await readDeviceFigures(
			view,
			"u1",
			["glance.spent"],
			{},
			FIGURES_NOW,
		);
		return readings.get("glance.spent");
	});
	return lines?.find((l) => l.currency === "ARS")?.minor ?? 0;
}

/** The row the pull left, as the device keeps it. */
async function pulledRow(engine: DeviceEngine, id = "e1") {
	const row = await engine.readWithPending((view) => view.get("expenses", id));
	return withoutText(row as ExpenseRow);
}

type Row = Awaited<ReturnType<typeof pulledRow>>;
const change = (
	id: string,
	before: Row | null,
	after: Row | null,
): PendingChange => ({ table: "expenses", id, before, after });
const entry = (
	clientId: string,
	changes: PendingChange[],
	over: Partial<PendingEntry> = {},
): PendingEntry => ({
	clientId,
	bookedAt: BOOKED_AT,
	changes,
	changed: [],
	parked: false,
	...over,
});
const created = (row: Row, id = "n1"): Row => ({ ...row, id, version: null });

beforeEach(() => {
	vi.useFakeTimers({ now: NOW });
	warn.mockClear();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("the overlay read", () => {
	it("adds a pending create, an edit and a delete to spent", async () => {
		const { engine, pending } = setup([page([booked("e1")])]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		expect(await spentOf(engine)).toBe(15_450_000);

		pending.list = [entry("c1", [change("n1", null, created(e1))])];
		expect(await spentOf(engine)).toBe(30_900_000);

		pending.list = [entry("c1", [change("e1", e1, { ...e1, ...AMOUNT_120 })])];
		expect(await spentOf(engine)).toBe(18_540_000);

		pending.list = [entry("c1", [change("e1", e1, null)])];
		expect(await spentOf(engine)).toBe(0);
	});

	it("reads a chained edit against the row the first edit left", async () => {
		const { engine, pending } = setup([page([booked("e1")])]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		const e120 = { ...e1, ...AMOUNT_120 };
		const e130 = { ...e120, ...AMOUNT_130 };
		const first = entry("c1", [change("e1", e1, e120)]);
		const second = entry("c2", [change("e1", e120, e130)]);

		pending.list = [first, second];
		expect(await spentOf(engine)).toBe(20_085_000);

		// The second edit's `before` is the 120 row, which the store never held: with
		// nothing before it, it is left out whole.
		pending.list = [second];
		expect(await spentOf(engine)).toBe(15_450_000);
		pending.list = [{ ...first, parked: true }, second];
		expect(await spentOf(engine)).toBe(15_450_000);
	});

	it("leaves out a parked entry and an unbooked one, whatever rows they carry", async () => {
		const { engine, pending } = setup([page([booked("e1")])]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		const rows = [change("n1", null, created(e1))];
		pending.list = [
			entry("c1", rows, { parked: true }),
			entry("c2", rows, { unbooked: "no_rate" }),
		];
		expect(await spentOf(engine)).toBe(15_450_000);
	});

	it("carries the fields spent reads: an edit to an income category or a spread parent leaves spent", async () => {
		const { engine, pending } = setup([page([booked("e1")])]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.list = [
			entry("c1", [
				change("e1", e1, { ...e1, categoryId: "inc", categoryKind: "INCOME" }),
			]),
		];
		expect(await spentOf(engine)).toBe(0);
		pending.list = [
			entry("c1", [change("e1", e1, { ...e1, isAmortizedParent: true })]),
		];
		expect(await spentOf(engine)).toBe(0);
	});

	it("keeps the store's text under an edit and gives a create fixed placeholder text", async () => {
		const { engine, pending } = setup([page([booked("e1")])]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.list = [
			entry("c1", [
				change("e1", e1, { ...e1, ...AMOUNT_120 }),
				change("n1", null, created(e1)),
			]),
		];
		const seen = await engine.readWithPending((view) => [
			view.get("expenses", "e1"),
			view.get("expenses", "n1"),
		]);
		expect(seen?.[0]).toMatchObject({ title: "row", amount: "120" });
		expect(seen?.[1]).toMatchObject({
			title: "",
			description: null,
			location: null,
		});
	});

	it("lets the row a pull brought win over an entry that expects another", async () => {
		// Another device edited e1 to USD 80 (123,600.00) under this phone's pending edit 100 to 120.
		const other = { amount: "80", amountInUSD: "80", homeAmount: "123600.00" };
		const { engine, pending } = setup([page([booked("e1", other)])]);
		await engine.pull();
		const now = await pulledRow(engine);
		const before = {
			...now,
			amount: "100",
			amountInUSD: "100",
			homeAmount: "154500.00",
		};
		pending.list = [
			entry("c1", [change("e1", before, { ...before, ...AMOUNT_120 })]),
		];
		expect(await spentOf(engine)).toBe(12_360_000);
	});

	it("counts an acked create once when a pull has brought it, and lets the pulled booking win", async () => {
		// The pull brings n1 as the server booked it, at 1550: 155,000.00.
		const server = { homeRate: "1550", homeAmount: "155000.00" };
		const { engine, pending } = setup([
			page([booked("e1")]),
			page([booked("e1"), booked("n1", server)], "c2"),
		]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		const ack = { version: DAY, pull: 2 };
		pending.list = [entry("c1", [change("n1", null, created(e1))], { ack })];
		await engine.pull();
		// The entry's ack names a pull that has not begun after it: it still counts, but the stored row wins.
		expect(await spentOf(engine)).toBe(15_450_000 + 15_500_000);
	});

	it("counts an acked create until a pull that began after the ack has finished", async () => {
		const { engine, pending } = setup([
			page([booked("e1")]),
			page([booked("e1")], "c2"),
			page([booked("e1"), booked("n1")], "c3"),
		]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		// Acked while pull 2 was running: it may not have seen the write.
		pending.list = [
			entry("c1", [change("n1", null, created(e1))], {
				ack: { version: DAY, pull: 2 },
			}),
		];
		await engine.pull();
		expect(engine.pullsBegun).toBe(2);
		expect(await spentOf(engine)).toBe(30_900_000);
		expect(pending.retired).toEqual([]);
		await engine.pull();
		expect(pending.retired).toEqual(["c1"]);
		expect(await spentOf(engine)).toBe(30_900_000);
	});

	it("reads the store as it is without a pending source, and null while a pull runs", async () => {
		const { api } = fakeDeviceApi({ rates, expenses: [page([booked("e1")])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		const running = engine.pull();
		expect(await engine.readWithPending(() => 1)).toBeNull();
		await running;
		expect(await spentOf(engine)).toBe(15_450_000);
	});
});

describe("retiring and comparing on a pull", () => {
	/** An acked edit to USD 120 (or a create) that a later pull brings, with the server's row given. */
	async function acked(
		server: ReturnType<typeof booked>,
		change_: (e1: Row) => PendingChange,
		over: Partial<PendingEntry> = {},
		extraPages: ReturnType<typeof page>[] = [],
	) {
		const { engine, pending } = setup([
			page([booked("e1")]),
			...extraPages,
			page([server], "c9"),
		]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.list = [
			entry("c1", [change_(e1)], {
				ack: { version: server.updatedAt, pull: engine.pullsBegun },
				...over,
			}),
		];
		return { engine, pending };
	}
	const edited = (over: Record<string, unknown> = {}) =>
		booked("e1", {
			...AMOUNT_120,
			updatedAt: "2026-10-15T14:59:30.000Z",
			...over,
		});
	const edit = (e1: Row) =>
		change("e1", e1, { ...e1, ...AMOUNT_120, version: null });

	it("counts a match and retires the entry", async () => {
		const { engine, pending } = await acked(edited(), edit);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 1 });
		expect(pending.retired).toEqual(["c1"]);
		expect(warn).toHaveBeenCalledWith("writes checked", expect.any(String));
	});

	it("names a differing field by id and name, with no amount, title or note in the log", async () => {
		const { engine } = await acked(edited({ homeAmount: "185500.00" }), edit);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ differs: 1 });
		const [what, detail] = warn.mock.calls.at(-1) ?? [];
		expect(what).toBe("writes differ from the server");
		expect(JSON.parse(detail ?? "").findings).toEqual([
			{ id: "e1", outcome: "differs", fields: ["homeAmount"] },
		]);
		expect(detail).not.toMatch(/185|1545|1550|120|\brow\b/);
	});

	it("compares excludeFromAnalytics too", async () => {
		const { engine } = await acked(
			edited({ excludeFromAnalytics: true }),
			edit,
		);
		await engine.pull();
		expect(engine.writeParity.recent).toEqual([
			{ id: "e1", outcome: "differs", fields: ["excludeFromAnalytics"] },
		]);
	});

	it("skips a row written since the ack", async () => {
		const { engine } = await acked(
			edited({ updatedAt: "2026-10-15T14:59:59.000Z" }),
			(e1) => edit(e1),
			{ ack: { version: "2026-10-15T14:59:30.000Z", pull: 1 } },
		);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ "skipped:changed_since": 1 });
	});

	it("skips a write whose rates moved after it was booked", async () => {
		const { engine } = await acked(edited(), edit, {
			bookedAt: Date.parse(rates.asOf) - 60 * 60_000,
		});
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ "skipped:rates_moved": 1 });
	});

	it("skips an edit of a row that is gone", async () => {
		const { engine, pending } = setup([
			page([booked("e1")]),
			page([], "c2", [{ id: "e1" }]),
		]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.list = [
			entry("c1", [edit(e1)], { ack: { version: DAY, pull: 1 } }),
		];
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ "skipped:gone_already": 1 });
	});

	it("expects the tombstone for a delete", async () => {
		const { engine, pending } = setup([
			page([booked("e1")]),
			page([], "c2", [{ id: "e1" }]),
		]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.list = [
			entry("c1", [change("e1", e1, null)], {
				ack: { version: null, pull: 1 },
			}),
		];
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 1 });
	});

	it("finds a deleted row still there at the version it had", async () => {
		const { engine, pending } = setup([
			page([booked("e1")]),
			page([booked("e1")], "c2"),
		]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.list = [
			entry("c1", [change("e1", e1, null)], {
				ack: { version: null, pull: 1 },
			}),
		];
		await engine.pull();
		expect(engine.writeParity.recent).toEqual([
			{ id: "e1", outcome: "differs", fields: ["deleted"] },
		]);
	});

	it("waits for a pull that began after the ack", async () => {
		const { engine, pending } = setup([page([booked("e1")])]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.list = [
			entry("c1", [edit(e1)], { ack: { version: DAY, pull: 2 } }),
		];
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({});
		expect(pending.retired).toEqual([]);
	});

	it("compares an entry once even when the list is slow to retire it", async () => {
		const { engine, pending } = await acked(edited(), edit);
		pending.forgetful = true;
		await engine.pull();
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 1 });
	});

	it("counts the writes that left without a pull by code", async () => {
		const { engine, pending } = setup([page([booked("e1")])]);
		await engine.pull();
		const e1 = await pulledRow(engine);
		pending.left = [
			{ entry: entry("c1", [edit(e1)]), code: "undone" },
			{ entry: entry("c2", [edit(e1)]), code: "expired" },
		];
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({
			"skipped:undone": 1,
			"skipped:expired": 1,
		});
	});
});

describe("never on screen", () => {
	const basis: FigureBasis = {
		asOf: cursor("200"),
		cut: cursor("200"),
		at: NOW.toISOString(),
		ratesAsOf: null,
		home: "ARS",
		timeZone: "America/Argentina/Buenos_Aires",
		startDay: 1,
	};
	const serverPage = {
		items: [booked("e1")],
		tombstones: [],
		cursor: cursor("200"),
		hasMore: false,
	};

	it("gives the compare the same report with and without a pending create", async () => {
		const read = async (withEntry: boolean) => {
			const pending = new FakePending();
			const { api } = fakeDeviceApi({
				expenses: [serverPage],
				categories: [{ ...serverPage, items: [] }],
				figures: { "glance.spent": HOME_ARS(15_450_000) },
				basis,
			});
			const engine = createDeviceEngine(api, "u1", Date.now, {
				warn,
				pending,
			});
			await engine.pull();
			if (withEntry) {
				const e1 = await pulledRow(engine);
				pending.list = [entry("c1", [change("n1", null, created(e1))])];
				expect(await spentOf(engine)).toBe(30_900_000);
			}
			return engine.compare("settings");
		};
		const without = await read(false);
		expect(without?.classes["glance.spent"]).toBe("match");
		expect(await read(true)).toEqual(without);
	});
});

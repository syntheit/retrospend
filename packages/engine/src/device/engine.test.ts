import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceMonthView } from "../budget-figures";
import { budgetStatus } from "../budget-gate";
import { readDeviceFigures } from "../registry";
import {
	createDeviceEngine as create,
	type DeviceEngineOptions,
	PULL_AFTER_MS,
} from "./engine";
import { expense, fakeDeviceApi } from "./fake-api";

// Lets a test act while the figures are being read; reads as the real one otherwise.
vi.mock("../registry", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../registry")>();
	return { ...actual, readDeviceFigures: vi.fn(actual.readDeviceFigures) };
});
vi.mock("../budget-gate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../budget-gate")>();
	return { ...actual, budgetStatus: vi.fn(actual.budgetStatus) };
});
vi.mock("../budget-figures", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../budget-figures")>();
	return { ...actual, deviceMonthView: vi.fn(actual.deviceMonthView) };
});
const actualRegistry =
	await vi.importActual<typeof import("../registry")>("../registry");
const actualGate =
	await vi.importActual<typeof import("../budget-gate")>("../budget-gate");
const readDuring = (act: () => Promise<unknown>) =>
	vi.mocked(readDeviceFigures).mockImplementationOnce(async (...args) => {
		await act();
		return actualRegistry.readDeviceFigures(...args);
	});

// The device engine on a server double. The user's home currency is ARS in
// Buenos Aires, the month starts on the 1st, and "now" is 2026-10-15 12:00
// there (15:00 UTC). Expenses (ARS, so no rate is read):
//   e1  1,000 on Oct 5    this month
//   e2  2,000 on Sep 10   last month, before the 15th
//   e3    500 on Sep 20   last month, after the 15th
// so Spent is 1,000.00 (100,000 minor), Spent last month by this day is
// 2,000.00 (200,000) and Spent last month is 2,500.00 (250,000).
const NOW = new Date("2026-10-15T15:00:00.000Z");
const ROWS = [
	expense("e1", "1000", "2026-10-05T15:00:00.000Z"),
	expense("e2", "2000", "2026-09-10T15:00:00.000Z"),
	expense("e3", "500", "2026-09-20T15:00:00.000Z"),
];
const page = (items: unknown[], cursor = "c1") => ({
	items,
	tombstones: [],
	cursor,
	hasMore: false,
});
const ARS = (minor: number) => [{ minor, currency: "ARS" }];

const warn = vi.fn<(what: string, detail?: string) => void>();
const createDeviceEngine = (
	api: Parameters<typeof create>[0],
	userId: string,
	now: () => number = Date.now,
	options: DeviceEngineOptions = {},
) => create(api, userId, now, { warn, ...options });
beforeEach(() => {
	vi.useFakeTimers({ now: NOW });
	warn.mockClear();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("reading figures", () => {
	it("pulls on the first read, then reads the figures it has from the rows", async () => {
		const { api, calls } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		expect(engine.status).toBe("idle");

		const read = await engine.read([
			"glance.spent",
			"glance.spentLastToDate",
			"glance.spentLast",
			"owed.owedToYou",
		]);

		expect(calls[0]).toBe("settings");
		expect(engine.status).toBe("ready");
		expect(engine.generation).toBe(1);
		expect(read?.homeCurrency).toBe("ARS");
		expect(read?.budgetReady).toBe(false);
		expect(Object.fromEntries(read?.readings ?? [])).toEqual({
			"glance.spent": ARS(100_000),
			"glance.spentLastToDate": ARS(200_000),
			"glance.spentLast": ARS(250_000),
		});
	});

	it("reads nothing when the pull failed, and again once a later pull works", async () => {
		const { api } = fakeDeviceApi({
			expenses: [page(ROWS)],
			fail: { route: "expenses", pull: 1, error: new Error("offline") },
		});
		const engine = createDeviceEngine(api, "u1");
		expect(await engine.read(["glance.spent"])).toBeNull();
		expect(engine.status).toBe("failed");
		expect(engine.generation).toBe(0);

		await engine.pull();
		expect(engine.status).toBe("ready");
		expect(
			(await engine.read(["glance.spent"]))?.readings.get("glance.spent"),
		).toEqual(ARS(100_000));
	});
});

describe("a fresh read", () => {
	it("pulls again before it reads, even when the rows are young", async () => {
		const { api, pulls } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		const read = await engine.read(["glance.spent"], { fresh: true });
		expect(pulls()).toBe(2);
		expect(engine.generation).toBe(2);
		expect(read?.readings.get("glance.spent")).toEqual(ARS(100_000));
	});

	// The pull running now began before the call, so a write the caller has
	// just seen confirmed may not be in its rows: it is waited out, then repeated.
	it("waits out a pull already running and pulls once more", async () => {
		const { api, pulls } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		const running = engine.pull();
		const read = await engine.read(["glance.spent"], { fresh: true });
		await running;
		expect(pulls()).toBe(2);
		expect(read).not.toBeNull();
	});

	it("reads nothing when its pull fails", async () => {
		const { api } = fakeDeviceApi({
			expenses: [page(ROWS)],
			fail: { route: "expenses", pull: 2, error: new Error("offline") },
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		expect(await engine.read(["glance.spent"], { fresh: true })).toBeNull();
		expect(engine.generation).toBe(1);
	});

	// Offline before the first write leaves the rows as they were and the
	// engine ready, but they are no fresher than the call: nothing is read.
	it("reads nothing when its pull fails before it wrote anything", async () => {
		const { api } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		(api.sync as unknown as Record<string, unknown>).settings = async () => {
			throw new Error("offline");
		};
		expect(await engine.read(["glance.spent"], { fresh: true })).toBeNull();
		expect(engine.status).toBe("ready");
		expect(engine.generation).toBe(1);
		expect(await engine.read(["glance.spent"])).not.toBeNull();
	});

	it("reads nothing from an engine that was disposed", async () => {
		const { api } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		await engine.dispose({ wipe: false });
		expect(await engine.read([], { fresh: true })).toBeNull();
	});
});

describe("the budget month", () => {
	const dto = {
		book: { id: "book", currency: "ARS" },
		month: { key: 202610 },
		today: "2026-10-15",
		approximate: false,
		incomplete: false,
		verdict: { lead: { figureId: "budget.leftToSpend" } },
	};
	const ready = () => vi.mocked(budgetStatus);
	const view = () => vi.mocked(deviceMonthView);
	afterEach(() => ready().mockImplementation(actualGate.budgetStatus));

	it("is the month view's book, month, day and verdict when asked for and the block is readable", async () => {
		const { api } = fakeDeviceApi();
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		ready().mockReturnValue("ready");
		view().mockResolvedValueOnce(dto as never);
		const read = await engine.read([], { budget: true });
		expect(read?.budget).toEqual({
			bookId: "book",
			currency: "ARS",
			month: 202610,
			today: "2026-10-15",
			approximate: false,
			incomplete: false,
			verdict: dto.verdict,
		});
	});

	it("is read at the engine's own clock", async () => {
		const { api } = fakeDeviceApi();
		const engine = createDeviceEngine(api, "u1", () => 42_000);
		await engine.pull();
		ready().mockReturnValue("ready");
		view().mockResolvedValueOnce(dto as never);
		await engine.read([], { budget: true });
		const clock = view().mock.calls.at(-1)?.[2] as () => Date;
		expect(clock().getTime()).toBe(42_000);
	});

	it("is not read unless asked for, nor while the block is not readable", async () => {
		const { api } = fakeDeviceApi();
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		view().mockClear();
		ready().mockReturnValue("ready");
		expect((await engine.read([]))?.budget).toBeNull();
		expect(view()).not.toHaveBeenCalled();
		ready().mockReturnValue("stale");
		expect((await engine.read([], { budget: true }))?.budget).toBeNull();
		expect(view()).not.toHaveBeenCalled();
	});

	it("loses only the budget when the month view fails", async () => {
		const { api } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		ready().mockReturnValue("ready");
		view().mockRejectedValueOnce(new Error("boom"));
		const read = await engine.read(["glance.spent"], { budget: true });
		expect(read?.budget).toBeNull();
		expect(read?.readings.get("glance.spent")).toEqual(ARS(100_000));
	});
});

describe("a budget verdict that differs", () => {
	it("is kept in the last parity check and warned with ids and parts only", async () => {
		const { api } = fakeDeviceApi();
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		engine.reportVerdict("budget.leftToSpend", ["state", "amount"], {
			device: { lead: { amount: { minor: 4_999_900 } } },
			server: { lead: { amount: { minor: 5_000_000 } } },
		});
		expect(engine.lastParity?.ids).toEqual(["budget.leftToSpend"]);
		expect(engine.lastParity?.mismatches).toHaveLength(1);
		expect(engine.lastParity?.generation).toBe(1);
		const logged = warn.mock.calls.flat().join(" ");
		expect(logged).toContain("budget.leftToSpend");
		expect(logged).toContain("amount");
		expect(logged).not.toMatch(/4999900|5000000/);
	});
});

describe("a read while a pull begins", () => {
	// Each reading below was made from rows a pull has since touched, so it is
	// dropped and Home keeps the server's value.
	it("is dropped when a pull is still running at the end of the read", async () => {
		const { api } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		readDuring(async () => {
			void engine.pull();
		});
		expect(await engine.read(["glance.spent"])).toBeNull();
		await engine.pull();
		expect(
			(await engine.read(["glance.spent"]))?.readings.get("glance.spent"),
		).toEqual(ARS(100_000));
	});

	it("is dropped when a whole pull began and ended during the read", async () => {
		const { api } = fakeDeviceApi({ expenses: [page(ROWS)] });
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		readDuring(() => engine.pull());
		expect(await engine.read(["glance.spent"])).toBeNull();
		expect(engine.status).toBe("ready");
		expect(engine.generation).toBe(2);
	});
});

describe("pulling", () => {
	it("runs one pull at a time", async () => {
		const { api, calls } = fakeDeviceApi();
		const engine = createDeviceEngine(api, "u1");
		await Promise.all([engine.pull(), engine.pull(), engine.read([])]);
		expect(calls.filter((c) => c === "settings")).toHaveLength(1);
		expect(engine.generation).toBe(1);
	});

	it("pulls again only once the last pull is a minute old", async () => {
		let t = 0;
		const { api, pulls } = fakeDeviceApi();
		const engine = createDeviceEngine(api, "u1", () => t);
		await engine.pullIfStale();
		t = PULL_AFTER_MS - 1;
		await engine.pullIfStale();
		expect(pulls()).toBe(1);
		t = PULL_AFTER_MS;
		await engine.pullIfStale();
		expect(pulls()).toBe(2);
	});

	// The second pull answers 410 for expenses: the rows pulled so far cannot
	// be trusted, so the engine starts over and asks for expenses again from the
	// start. e1 is gone from the server's answer, so it is gone from the rows.
	it("starts over in a new store when the server cannot honor a cursor", async () => {
		const { api, calls } = fakeDeviceApi({
			expenses: [page(ROWS, "c1"), page([ROWS[1]], "c2")],
			fail: {
				route: "expenses",
				pull: 2,
				error: Object.assign(new Error("gone"), {
					code: "sync_reset_required",
				}),
			},
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		await engine.pull();
		// First pull: since none. Second: since c1 (410), then since none again.
		expect(calls.filter((c) => c.startsWith("expenses"))).toEqual([
			"expenses(-)",
			"expenses(c1)",
			"expenses(-)",
		]);
		expect(engine.status).toBe("ready");
		expect(engine.generation).toBe(2);
		const read = await engine.read(["glance.spent", "glance.spentLast"]);
		expect(read?.readings.get("glance.spent")).toEqual(ARS(0));
		expect(read?.readings.get("glance.spentLast")).toEqual(ARS(200_000));
	});
});

describe("checking against the server", () => {
	const ids = ["glance.spent", "glance.spentLast"];

	it("records a match and says nothing", async () => {
		const { api } = fakeDeviceApi({
			expenses: [page(ROWS)],
			figures: {
				"glance.spent": ARS(100_000),
				"glance.spentLast": ARS(250_000),
			},
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		await engine.verify(ids);
		expect(engine.lastParity).toMatchObject({
			ids,
			mismatches: [],
			generation: 1,
			clock: NOW.toISOString(),
		});
		expect(warn).not.toHaveBeenCalled();
	});

	// The server says Spent last month is 2,600.00, which the rows do not
	// hold: one more pull cannot fix it, so the check warns with both readings
	// and the generation after that pull (2).
	it("pulls once more on a mismatch, then warns with both readings", async () => {
		const { api, pulls } = fakeDeviceApi({
			expenses: [page(ROWS)],
			figures: {
				"glance.spent": ARS(100_000),
				"glance.spentLast": ARS(260_000),
			},
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		await engine.verify(ids);
		expect(pulls()).toBe(2);
		expect(engine.lastParity).toMatchObject({
			generation: 2,
			mismatches: [
				{
					id: "glance.spentLast",
					device: ARS(250_000),
					server: ARS(260_000),
				},
			],
		});
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain("figures differ");
		// The log names the figure and counts, and carries no amount from either side.
		const logged = JSON.stringify(warn.mock.calls[0]);
		expect(logged).toContain("glance.spentLast");
		expect(logged).not.toMatch(/250000|260000|minor/);
		expect(JSON.parse(warn.mock.calls[0]?.[1] ?? "")).toMatchObject({
			ids: ["glance.spentLast"],
			count: 1,
			generation: 2,
		});
	});

	it("is quiet when the pull's rows catch up with what the server says", async () => {
		// The server already has e3 at its first answer; the device's first
		// pull did not (a write in between), the second does.
		const { api } = fakeDeviceApi({
			expenses: [page(ROWS.slice(0, 2)), page(ROWS, "c2")],
			figures: { "glance.spentLast": ARS(250_000) },
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		await engine.verify(["glance.spentLast"]);
		expect(engine.lastParity?.mismatches).toEqual([]);
		expect(engine.generation).toBe(2);
		expect(warn).not.toHaveBeenCalled();
	});
});

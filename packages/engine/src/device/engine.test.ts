import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDeviceFigures } from "../registry";
import {
	createDeviceEngine as create,
	type DeviceEngineOptions,
	PULL_AFTER_MS,
} from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import type { FigureBasis } from "./ports";

// Lets a test act while the figures are being read; reads as the real one otherwise.
vi.mock("../registry", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../registry")>();
	return { ...actual, readDeviceFigures: vi.fn(actual.readDeviceFigures) };
});
const actualRegistry =
	await vi.importActual<typeof import("../registry")>("../registry");
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

describe("comparing against the server", () => {
	const AT = "2026-10-15T15:00:00.000Z";
	const basis = (cut: string): FigureBasis => ({
		asOf: cursor("200"),
		cut: cursor(cut),
		at: AT,
		ratesAsOf: null,
		home: "ARS",
		timeZone: "America/Argentina/Buenos_Aires",
		startDay: 1,
	});
	const spent = { "glance.spent": ARS(100_000) };
	// The server's rows hold e1 at stamp 120 and one row stamped past the read's cut.
	const stamped = (t: string, items: unknown[] = []) => ({
		items,
		tombstones: [],
		cursor: cursor(t),
		hasMore: false,
	});

	it("checks the device against the server and logs the one line, ids and counts only", async () => {
		const { api } = fakeDeviceApi({
			expenses: [stamped("120", ROWS)],
			figures: spent,
			basis: basis("150"),
		});
		const engine = createDeviceEngine(api, "u1");
		const report = await engine.compare("settings");
		expect(report).toMatchObject({
			screen: "settings",
			state: "checked",
			skipped: null,
			differs: [],
			generation: 1,
		});
		expect(report?.classes["glance.spent"]).toBe("match");
		expect(engine.lastCompare).toBe(report);
		expect(warn).toHaveBeenCalledTimes(1);
		const [what, line] = warn.mock.calls[0] ?? [];
		expect(what).toBe("compare");
		expect(JSON.parse(line ?? "")).toMatchObject({
			screen: "settings",
			state: "checked",
			differs: [],
		});
		// The device's own reading is 100,000 minor: it is in no log.
		expect(line).not.toMatch(/100000|minor/);
	});

	// Every cursor is at the read's position and nothing came in past its cut,
	// so a figure that still differs is a real difference.
	it("names a figure the rows cannot make the server's", async () => {
		const { api } = fakeDeviceApi({
			expenses: [stamped("200", ROWS.slice(0, 1))],
			categories: [stamped("200")],
			figures: { "glance.spent": ARS(100_001) },
			basis: basis("200"),
		});
		const report = await createDeviceEngine(api, "u1").compare("settings");
		expect(report?.differs).toEqual(["glance.spent"]);
	});

	// The pull counts what arrives past the read's cut (150): rows stamped 170
	// were not in the read. The first pull brings one in, so the check reads
	// again after a second pull, which brings nothing, and it ends checked.
	it("counts the rows its pull brings in past the read's cut and reads both sides again", async () => {
		const { api, pulls, calls } = fakeDeviceApi({
			expenses: [stamped("170", [ROWS[0]]), stamped("170")],
			figures: spent,
			basis: basis("150"),
		});
		const report = await createDeviceEngine(api, "u1").compare("settings");
		expect(pulls()).toBe(2);
		expect(calls.filter((c) => c.startsWith("figures"))).toHaveLength(2);
		expect(report).toMatchObject({ state: "checked", skipped: null });
	});

	it("skips as moving when rows keep arriving past the cut", async () => {
		const { api, pulls } = fakeDeviceApi({
			expenses: [stamped("170", [ROWS[0]]), stamped("180", [ROWS[1]])],
			figures: spent,
			basis: basis("150"),
		});
		const report = await createDeviceEngine(api, "u1").compare("settings");
		expect(pulls()).toBe(2);
		expect(report).toMatchObject({ state: "skipped", skipped: "moving" });
	});

	it("skips with no basis (an old server or a read token), and never pulls", async () => {
		const { api, pulls } = fakeDeviceApi({ figures: spent });
		const report = await createDeviceEngine(api, "u1").compare("settings");
		expect(report).toMatchObject({ state: "skipped", skipped: "no_basis" });
		expect(pulls()).toBe(0);
	});

	it("hands a screen's verdict callback to the compare, once, and none for a screen without one", async () => {
		const { api } = fakeDeviceApi({ figures: spent, basis: basis("150") });
		const verdict = vi.fn(async () => null);
		await createDeviceEngine(api, "u1").compare("budget", {}, verdict);
		expect(verdict).toHaveBeenCalledTimes(1);
		const none = vi.fn(async () => null);
		await createDeviceEngine(api, "u1").compare("wealth", {}, none);
		expect(none).not.toHaveBeenCalled();
	});

	it("never starts for an account with Advanced protection, now or later", async () => {
		const refusal = Object.assign(new Error("Advanced protection is on"), {
			code: "protected_account",
		});
		const { api, calls } = fakeDeviceApi({ figuresError: refusal });
		const engine = createDeviceEngine(api, "u1");
		expect(await engine.compare("settings")).toBeNull();
		const asked = calls.length;
		expect(await engine.compare("budget")).toBeNull();
		// One refused request, then nothing: no pull, no more figures reads.
		expect(asked).toBe(1);
		expect(calls).toHaveLength(1);
		expect(engine.lastCompare).toBeNull();
	});

	it("does nothing on an engine that was disposed", async () => {
		const { api, calls } = fakeDeviceApi({
			figures: spent,
			basis: basis("150"),
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.dispose({ wipe: true });
		expect(await engine.compare("settings")).toBeNull();
		expect(calls).toEqual([]);
	});
});

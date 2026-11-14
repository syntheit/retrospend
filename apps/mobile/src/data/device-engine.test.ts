import { expense, fakeDeviceApi } from "../../test/deviceApi";
import { createDeviceEngine, engineFor, PULL_AFTER_MS } from "./device-engine";

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

let warn: jest.SpyInstance;
beforeEach(() => {
	jest.useFakeTimers({ now: NOW });
	warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	jest.useRealTimers();
	jest.restoreAllMocks();
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

	it("keeps one engine per client and account", () => {
		const { api } = fakeDeviceApi();
		const mine = engineFor(api, "u1");
		expect(engineFor(api, "u1")).toBe(mine);
		expect(engineFor(api, "u2")).not.toBe(mine);
		expect(engineFor(fakeDeviceApi().api, "u1")).not.toBe(mine);
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

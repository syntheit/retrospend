import { bookValuationKey } from "@retrospend/domain/envelope/book-valuation-key";
import type { Money } from "@retrospend/domain/money-minor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRow } from "../fixtures";
import type { TableRows } from "../port";
import { readDeviceFigures } from "../registry";
import type { VerdictView } from "./compare";
import {
	createDeviceEngine as create,
	type DeviceEngineOptions,
	PULL_AFTER_MS,
} from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import type { EngineStorage, FigureBasis, LoadedRows } from "./ports";

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

describe("pulling", () => {
	it("keeps the server's updatedAt as a string version on every row the fake serves", async () => {
		const committed: { table: string; row: unknown }[] = [];
		const { api } = fakeDeviceApi({
			expenses: [page(ROWS.slice(0, 2), cursor("100"))],
		});
		const engine = createDeviceEngine(api, "u1", Date.now, {
			storage: async () => ({
				loaded: { rows: {}, cursors: {}, complete: false },
				persistence: {
					commit: (changes) => {
						for (const c of changes) committed.push(c);
					},
					beginPull: () => undefined,
					finishPull: () => undefined,
					abandonPull: () => undefined,
					close: () => undefined,
				},
				dispose: async () => undefined,
			}),
		});
		await engine.pull();
		const rows = committed.filter((c) => c.table === "expenses") as {
			row: { id: string; version: unknown };
		}[];
		expect(rows.map((c) => c.row.id).sort()).toEqual(["e1", "e2"]);
		for (const { row } of rows) {
			expect(typeof row.version).toBe("string");
			expect(row.version).toBe(ROWS.find((r) => r.id === row.id)?.updatedAt);
		}
	});

	it("runs one pull at a time", async () => {
		const { api, calls } = fakeDeviceApi();
		const engine = createDeviceEngine(api, "u1");
		await Promise.all([engine.pull(), engine.pull(), engine.pullIfStale()]);
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
		const stamped = (t: string, items: unknown[]) => ({
			items,
			tombstones: [],
			cursor: cursor(t),
			hasMore: false,
		});
		const { api, calls } = fakeDeviceApi({
			expenses: [stamped("120", ROWS), stamped("130", [ROWS[1]])],
			fail: {
				route: "expenses",
				pull: 2,
				error: Object.assign(new Error("gone"), {
					code: "sync_reset_required",
				}),
			},
			// What the server's rows make: only e2 is left.
			figures: {
				"glance.spent": ARS(0),
				"glance.spentLast": ARS(200_000),
			},
			basis: {
				asOf: cursor("200"),
				cut: cursor("150"),
				at: "2026-10-15T15:00:00.000Z",
				ratesAsOf: null,
				home: "ARS",
				timeZone: "America/Argentina/Buenos_Aires",
				startDay: 1,
			},
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.pull();
		await engine.pull();
		// First pull: since none. Second: since the first's cursor (410), then since none again.
		expect(calls.filter((c) => c.startsWith("expenses"))).toEqual([
			"expenses(-)",
			`expenses(${cursor("120")})`,
			"expenses(-)",
		]);
		expect(engine.status).toBe("ready");
		expect(engine.generation).toBe(2);
		const report = await engine.compare("home");
		expect(report?.state).toBe("checked");
		expect(report?.classes["glance.spent"]).toBe("match");
		expect(report?.classes["glance.spentLast"]).toBe("match");
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

	it("skips when its pull failed, and checks once a later pull works", async () => {
		const { api } = fakeDeviceApi({
			expenses: [stamped("120", ROWS)],
			figures: spent,
			basis: basis("150"),
			fail: { route: "expenses", pull: 1, error: new Error("offline") },
		});
		const engine = createDeviceEngine(api, "u1");
		expect(await engine.compare("settings")).toMatchObject({
			state: "skipped",
			skipped: "no_device",
		});
		expect(engine.status).toBe("failed");
		const report = await engine.compare("settings");
		expect(report).toMatchObject({ state: "checked", differs: [] });
		expect(report?.classes["glance.spent"]).toBe("match");
	});

	// Each device read below was made from rows a pull has since touched.
	it.each([
		["is still running at the end of the read", false],
		["began and ended during the read", true],
	])("skips when a pull %s", async (_name, whole) => {
		const { api } = fakeDeviceApi({
			expenses: [stamped("120", ROWS)],
			figures: spent,
			basis: basis("150"),
		});
		const engine = createDeviceEngine(api, "u1");
		readDuring(async () => {
			if (whole) await engine.pull();
			else void engine.pull();
		});
		expect(await engine.compare("settings")).toMatchObject({
			state: "skipped",
			skipped: "no_device",
		});
	});

	// The server answers its cut 150, then a foreground pull (sign in, or the
	// app coming back) applies e1 stamped 170, past the cut. The compare's own
	// pull then brings nothing, so only the pull that began after the read can
	// say the device holds a row the server read did not. The server's second
	// read has e1, so the check ends as a match, never as a difference.
	it("reads both sides again when a pull of another caller applied rows past the cut", async () => {
		const { api, pulls, calls } = fakeDeviceApi({
			expenses: [stamped("170", [ROWS[0]]), stamped("170")],
			figures: spent,
			basis: basis("150"),
		});
		const engine = createDeviceEngine(api, "u1");
		const answer = api.figures.read;
		let reads = 0;
		api.figures.read = async (query) => {
			const served = await answer(query);
			reads += 1;
			if (reads > 1) return served;
			void engine.pull();
			return {
				...served,
				figures: served.figures.map((f) => ({ ...f, lines: ARS(0) })),
			};
		};
		const report = await engine.compare("settings");
		expect(calls.filter((c) => c.startsWith("figures"))).toHaveLength(2);
		expect(pulls()).toBe(3);
		expect(report).toMatchObject({
			state: "checked",
			skipped: null,
			differs: [],
		});
		expect(report?.classes["glance.spent"]).toBe("match");
	});

	// The pull running at the read fetches pages after it too.
	it("reads both sides again when a pull was already running at the server read", async () => {
		const { api, calls } = fakeDeviceApi({
			expenses: [stamped("170", [ROWS[0]]), stamped("170")],
			figures: spent,
			basis: basis("150"),
		});
		const engine = createDeviceEngine(api, "u1");
		void engine.pull();
		const report = await engine.compare("settings");
		expect(calls.filter((c) => c.startsWith("figures"))).toHaveLength(2);
		expect(report).toMatchObject({ state: "checked", differs: [] });
	});

	// The device clock is a month ahead of the server's read instant: the
	// device reads at the server's, so this month's Spent is e1's 1,000.00.
	it("reads the device at the server's instant, not its own clock", async () => {
		const { api } = fakeDeviceApi({
			expenses: [stamped("120", ROWS)],
			figures: spent,
			basis: basis("150"),
		});
		const engine = createDeviceEngine(api, "u1", () =>
			Date.parse("2026-11-02T12:00:00.000Z"),
		);
		const report = await engine.compare("settings");
		expect(report).toMatchObject({ state: "checked", differs: [] });
		expect(report?.classes["glance.spent"]).toBe("match");
	});

	it("hands the narrowing values to the device's read", async () => {
		const { api } = fakeDeviceApi({
			expenses: [stamped("120", ROWS)],
			figures: { "recurring.amount": ARS(0) },
			basis: basis("150"),
		});
		const engine = createDeviceEngine(api, "u1");
		await engine.compare("recurring", { recurringId: ["r1"] });
		const reads = vi
			.mocked(readDeviceFigures)
			.mock.calls.filter(([, , ids]) => ids.includes("recurring.amount"));
		expect(reads.map(([, , , narrowing]) => narrowing)).toEqual([
			{ recurringId: "r1" },
		]);
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

// A device that holds a budget book and the block made for it, from its disk
// copy, so the budget screen's verdict and the book's zone are read. The book
// is ARS in Buenos Aires, FLEX, the month starting on the 1st (budget month
// 202610), with no expenses: nothing is assigned or spent, so Left to spend is
// 0.00 ARS (a month with nothing to spend is USED_UP).
describe("comparing a budget the device holds", () => {
	const AT = "2026-10-15T15:00:00.000Z";
	const ZONE = "America/Argentina/Buenos_Aires";
	const START = new Date("2026-10-01T03:00:00.000Z");
	const bookRow = (timeZone = ZONE): TableRows["budgetBooks"] => ({
		...fixtureRow("budgetBooks", "book"),
		timeZone,
		startDate: START,
		startMonth: 202610,
		defaultEnvelopeId: "spending",
	});
	const periods: TableRows["bookPeriods"][] = [
		{
			id: "p1",
			bookId: "book",
			fromMonth: 202610,
			startDay: 1,
			rateType: "blue",
		},
	];
	const rows = (
		o: { zone?: string; missingRate?: boolean } = {},
	): LoadedRows => {
		const book = bookRow(o.zone);
		const snapshot = fixtureRow("budgetSnapshot", "budget");
		return {
			budgetBooks: [book],
			bookPeriods: periods,
			envelopeGroups: [
				{
					...fixtureRow("envelopeGroups", "g"),
					bookId: "book",
					role: "SPENDING",
					targetKind: "NONE",
					targetValue: null,
				},
			],
			envelopes: [
				{
					...fixtureRow("envelopes", "spending"),
					bookId: "book",
					groupId: "g",
					name: "Spending",
					kind: "MONTHLY",
					targetAmount: null,
				},
			],
			budgetSnapshot: [
				{
					...snapshot,
					bookId: "book",
					valuationKey: bookValuationKey({
						currency: book.currency,
						timeZone: book.timeZone,
						startDate: book.startDate,
						periods,
					}),
					frozen: [],
					splits: {
						...snapshot.splits,
						checkpointMissingRates: o.missingRate
							? [
									{
										currency: "ARS",
										rateType: "blue",
										date: "2026-10-11",
										rowId: "late",
									},
								]
							: [],
					},
				},
			],
		};
	};
	const storage = (loaded: LoadedRows) => async (): Promise<EngineStorage> => ({
		loaded: { rows: loaded, cursors: {}, complete: true },
		persistence: {
			commit: () => undefined,
			beginPull: () => undefined,
			finishPull: () => undefined,
			abandonPull: () => undefined,
			close: () => undefined,
		},
		dispose: async () => undefined,
	});
	const basis: FigureBasis = {
		asOf: cursor("200"),
		cut: cursor("150"),
		at: AT,
		ratesAsOf: null,
		home: "ARS",
		timeZone: ZONE,
		startDay: 1,
	};
	// What the server's month read makes of the same book.
	const server = (over: Partial<VerdictView> = {}): VerdictView => ({
		bookId: "book",
		currency: "ARS",
		month: 202610,
		today: "2026-10-15",
		style: "FLEX",
		incomplete: false,
		state: "USED_UP",
		action: null,
		lead: { figureId: "budget.leftToSpend", amount: ARS(0)[0] as Money },
		...over,
	});
	const open = (loaded: LoadedRows) => {
		const { api } = fakeDeviceApi({ figures: {}, basis });
		return createDeviceEngine(api, "u1", Date.now, {
			storage: storage(loaded),
		});
	};

	it("holds the device's verdict against the server's and calls them a match", async () => {
		const report = await open(rows()).compare("budget", {}, async () =>
			server(),
		);
		expect(report?.verdictParts).toEqual([]);
		expect(report?.classes.verdict).toBe("match");
	});

	it("names the parts of the verdict that differ", async () => {
		const report = await open(rows()).compare("budget", {}, async () =>
			server({
				state: "ON_TRACK",
				lead: { figureId: "budget.leftToSpend", amount: ARS(5)[0] as Money },
			}),
		);
		expect(report?.verdictParts).toEqual(["state", "amount"]);
		// The double's pulls end on cursors short of the read's position, so the cause is "behind".
		expect(report?.classes.verdict).toBe("behind");
	});

	// The device's own month says it is incomplete (a missing rate): it is no
	// verdict to compare, so none is held.
	it("holds no verdict when the device's month is incomplete", async () => {
		const report = await open(rows({ missingRate: true })).compare(
			"budget",
			{},
			async () => server(),
		);
		expect(report).toMatchObject({ state: "checked" });
		expect(report?.classes.verdict).toBeUndefined();
	});

	// The book's zone is not the settings zone: at 00:00:20 on Oct 15 in Tokyo
	// the month's days may roll over under one side's feet.
	it("skips at a day edge in the book's zone, which is not the settings zone", async () => {
		const { api } = fakeDeviceApi({
			figures: {},
			basis: { ...basis, at: "2026-10-14T15:00:20.000Z" },
		});
		const engine = createDeviceEngine(api, "u1", Date.now, {
			storage: storage(rows({ zone: "Asia/Tokyo" })),
		});
		expect(await engine.compare("budget")).toMatchObject({
			state: "skipped",
			skipped: "period_edge",
		});
	});
});

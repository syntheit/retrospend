/**
 * The compare core on a hand-built ledger. The user: home currency EUR, zone
 * UTC, fiscal month from the 1st. Rates (units per USD): ARS blue 1,545, ARS
 * official 1,050, EUR 0.9. Rows (ARS, no home value booked):
 *   e1  ARS 154,500.00 on Nov 10
 *   e2  ARS  77,250.00 on Nov 30
 * ARS 154,500 at blue 1,545 is USD 100, which is EUR 90.00 (9,000 minor); at
 * official 1,050 it would be USD 147.142857 and EUR 132.43 (13,243). e2 is
 * USD 50, EUR 45.00 (4,500).
 * The server read is at 2026-11-15T12:00Z unless a test says otherwise, so
 * Spent this month is e1 = EUR 90.00 and Spent last month is 0.
 */

import { WEALTH_FIGURE_IDS } from "@retrospend/domain/accounts/account-figures";
import { FigureNarrowingError } from "@retrospend/domain/figures/narrowing";
import { describe, expect, it } from "vitest";
import {
	pastPosition,
	positionReached,
	SYNC_RESET,
	syncedBook,
} from "../budget-gate";
import { fixtureRow } from "../fixtures";
import { MemoryStore } from "../memory-store";
import {
	BUDGET_SNAPSHOT_ID,
	OWED_ID,
	RATE_SYNC_ID,
	type Reader,
	SETTINGS_ID,
	TABLE_NAMES,
	type TableName,
	type TableRows,
} from "../port";
import {
	DEVICE_FIGURE_IDS,
	readDeviceFigures,
	serverOnlyReason,
} from "../registry";
import { pullAll } from "../sync-pull";
import {
	compareLine,
	edgeOf,
	keyOf,
	MAX_IDS_PER_CALL,
	MAX_NARROWED_CALLS,
	type Narrow,
	parseKey,
	planCheck,
	SCREENS,
	type ScreenName,
	sameLines,
	type VerdictView,
	verdictParts,
} from "./compare";
import {
	type CompareDeps,
	type CompareRequest,
	compareScreen,
	type PulledPast,
} from "./compare-run";
import { fakeDeviceApi, expense as wireExpense } from "./fake-api";
import type { FigureBasis, FigureNarrowing, ServerFigures } from "./ports";

const at = (iso: string) => new Date(iso);
const eur = (minor: number) => [{ minor, currency: "EUR" }];
const NOON = "2026-11-15T12:00:00.000Z";

/** A sync cursor, {e, t, s} as base64url JSON, the way the server writes it. */
const cursor = (t: string, e = "e1") => {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const bytes = [...JSON.stringify({ e, t, s: "9" })].map((c) =>
		c.charCodeAt(0),
	);
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const [x = 0, y, z] = [bytes[i], bytes[i + 1], bytes[i + 2]];
		const n = (x << 16) | ((y ?? 0) << 8) | (z ?? 0);
		out += alphabet[(n >> 18) & 63];
		out += alphabet[(n >> 12) & 63];
		if (y !== undefined) out += alphabet[(n >> 6) & 63];
		if (z !== undefined) out += alphabet[n & 63];
	}
	return out;
};

const rate = (
	currency: string,
	type: string,
	value: string,
): TableRows["rates"] => ({
	id: `${currency}:${type}`,
	currency,
	type,
	rate: value,
	date: at("2026-11-01T00:00:00Z"),
});
const row = (id: string, amount: string, date: string) => ({
	...fixtureRow("expenses", id),
	homeCurrency: null,
	homeAmount: null,
	currency: "ARS",
	amount,
	amountInUSD: String(Number(amount) / 1545),
	categoryId: null,
	date: at(date),
});

function ledger(
	o: { rates?: boolean; e1?: boolean; e2?: boolean; account?: boolean } = {},
) {
	return new MemoryStore({
		rows: {
			settings: [
				{
					id: SETTINGS_ID,
					homeCurrency: "EUR",
					timeZone: "UTC",
					startDay: 1,
					hiddenProjectIds: [],
				},
			],
			owed: [{ id: OWED_ID, currency: "EUR", owedToYou: 0, youOwe: 0 }],
			accounts: o.account
				? [
						{
							...fixtureRow("accounts", "accounts-1"),
							exchangeRate: null,
							exchangeRateType: null,
						},
					]
				: [],
			rates:
				o.rates === false
					? []
					: [
							rate("ARS", "blue", "1545"),
							rate("ARS", "official", "1050"),
							rate("EUR", "official", "0.9"),
						],
			expenses: [
				...(o.e1 === false
					? []
					: [row("e1", "154500", "2026-11-10T12:00:00Z")]),
				...(o.e2 ? [row("e2", "77250", "2026-11-30T12:00:00Z")] : []),
			],
		} as never,
	});
}

const BASIS: FigureBasis = {
	asOf: cursor("100"),
	at: NOON,
	ratesAsOf: "R1",
	home: "EUR",
	timeZone: "UTC",
	startDay: 1,
};

/** What the server answers on Home for the ledger above, derived in the header. */
const HOME_SERVER: Record<
	string,
	readonly { minor: number; currency: string }[] | null
> = {
	"glance.spent": eur(9000),
	"glance.spentLastToDate": eur(0),
	"glance.spentLast": eur(0),
	"glance.moneyIn": eur(0),
	netWorth: eur(0),
	"budget.notPlannedYet": null,
};

interface World {
	store?: MemoryStore;
	server?: Record<
		string,
		readonly { minor: number; currency: string }[] | null
	>;
	basis?: FigureBasis | null;
	/** The basis of each server call, by call number from 0; the last repeats. */
	bases?: FigureBasis[];
	cursorT?: string;
	ratesAsOf?: string | null;
	home?: string;
	timeZone?: string;
	startDay?: number;
	deviceNow?: string;
	bookZone?: string | null;
	/** What each pull brought in past the read, by pull number; the last repeats. Default: nothing. */
	pulled?: (PulledPast | null)[];
	/** Runs in each pull, with its number from 1: another user's write moves the position, a catch-up moves the store. */
	onPull?: (n: number) => void;
	device?: "none";
	verdict?: VerdictView;
}

function world(w: World = {}) {
	let store = w.store ?? ledger();
	const events: string[] = [];
	const serverQueries: ({ ids: string } & FigureNarrowing)[] = [];
	const deviceQueries: { narrowing: FigureNarrowing; at: Date }[] = [];
	const pastArgs: string[] = [];
	let cursorT = w.cursorT ?? "100";
	let pulls = 0;
	const deps: CompareDeps = {
		figures: {
			read: async (q) => {
				events.push("server");
				serverQueries.push(q);
				return {
					figures: q.ids.split(",").map((id) => ({
						id,
						lines: (w.server ?? HOME_SERVER)[id] ?? null,
					})),
					...(w.basis === null
						? {}
						: {
								basis:
									w.bases?.[
										Math.min(serverQueries.length - 1, w.bases.length - 1)
									] ??
									w.basis ??
									BASIS,
							}),
				} satisfies ServerFigures;
			},
		},
		read: async (q) => {
			events.push("device");
			deviceQueries.push({ narrowing: q.narrowing, at: q.at });
			if (w.device === "none") return null;
			const { readings } = await readDeviceFigures(
				store,
				"u1",
				q.ids,
				q.narrowing,
				() => q.at,
			);
			return {
				lines: readings,
				verdict: q.verdict ? (w.verdict ?? null) : null,
			};
		},
		pull: async (past) => {
			events.push("pull");
			pastArgs.push(past);
			pulls += 1;
			w.onPull?.(pulls);
			const queue = w.pulled ?? [{}];
			return queue[Math.min(pulls, queue.length) - 1] ?? null;
		},
		cursors: () =>
			Object.fromEntries(
				Object.values(SCREENS).flatMap((s) =>
					s.entities.map((e) => [e, cursor(cursorT)]),
				),
			),
		ratesAsOf: () => (w.ratesAsOf === undefined ? "R1" : w.ratesAsOf),
		settings: () => ({
			homeCurrency: w.home ?? "EUR",
			timeZone: w.timeZone ?? "UTC",
			startDay: w.startDay ?? 1,
		}),
		bookZone: () => w.bookZone ?? null,
		generation: () => pulls,
		now: () => at(w.deviceNow ?? NOON),
	};
	return {
		deps,
		events,
		serverQueries,
		deviceQueries,
		pastArgs,
		setStore: (s: MemoryStore) => {
			store = s;
		},
		setCursor: (t: string) => {
			cursorT = t;
		},
	};
}

const request = (
	screen: ScreenName,
	extra: Partial<CompareRequest> = {},
): CompareRequest => ({ screen, browserZone: "UTC", ...extra });

describe("compareScreen on Home", () => {
	it("reads the server, then pulls to its position, then reads the device", async () => {
		const w = world();
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report).toMatchObject({
			state: "checked",
			skipped: null,
			keys: 6,
			of: 6,
			differs: [],
			behind: 0,
			ratesMoved: 0,
			zone: "same",
			generation: 1,
		});
		expect(Object.values(report.classes)).toEqual(Array(6).fill("match"));
		expect(w.events).toEqual(["server", "pull", "device"]);
		expect(w.pastArgs).toEqual([BASIS.asOf]);
	});

	// ARS 154,500 at official 1,050 is EUR 132.43: a server that valued the
	// rate type the device does not read gives another number.
	it("names a figure that differs when the pull brought in nothing past the read", async () => {
		const w = world({
			server: { ...HOME_SERVER, "glance.spent": eur(13_243) },
		});
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report.differs).toEqual(["glance.spent"]);
		expect(report.classes["glance.spent"]).toBe("differs");
		expect(report).toMatchObject({ behind: 0, ratesMoved: 0 });
		// One round: the pull has already brought the device up, so no second read.
		expect(w.events).toEqual(["server", "pull", "device"]);
	});

	// Production order: the server is read, then another user writes (the
	// cluster position moves past the read), then the device pulls. The
	// device's cursors are past the read, none of the rows are this user's,
	// and a real difference is a difference, not lag.
	it("keeps a real difference a difference when another user's write moved the position", async () => {
		const w = world({
			server: { ...HOME_SERVER, "glance.spent": eur(13_243) },
			onPull: () => w.setCursor("107"),
			pulled: [{ expenses: 0, categories: 0 }],
		});
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report.classes["glance.spent"]).toBe("differs");
		expect(report).toMatchObject({ differs: ["glance.spent"], behind: 0 });
	});

	// A pull that did not reach the read (a transaction open at its cut) is
	// real lag and says so.
	it("calls a pull that stopped below the read behind", async () => {
		const w = world({
			store: ledger({ e1: false }),
			cursorT: "90",
		});
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report).toMatchObject({ behind: 1, differs: [] });
		expect(report.classes["glance.spent"]).toBe("behind");
	});

	it("reads both sides again when the pull brought in the user's rows past the read, and matches once the device holds them", async () => {
		const w = world({
			store: ledger({ e1: false }),
			pulled: [{ expenses: 1 }, {}],
			onPull: (n) => {
				if (n === 1) w.setStore(ledger());
			},
		});
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report).toMatchObject({ state: "checked", differs: [], behind: 0 });
		expect(report.classes["glance.spent"]).toBe("match");
		expect(w.events).toEqual(["server", "pull", "server", "pull", "device"]);
		// The second read of the server moves the position the pull measures from.
		expect(w.pastArgs).toHaveLength(2);
	});

	it("skips as moving when rows keep arriving past the read", async () => {
		const w = world({ pulled: [{ expenses: 2 }, { expenses: 1 }] });
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report).toMatchObject({ state: "skipped", skipped: "moving" });
		expect(w.events.filter((e) => e === "pull")).toHaveLength(2);
		expect(w.events).not.toContain("device");
	});

	it("counts only the entities the screen reads", async () => {
		const w = world({ pulled: [{ wealthTransfers: 0, projects: 9 }] });
		const { report } = await compareScreen(w.deps, request("insights"));
		expect(report.state).toBe("checked");
		const other = world({ pulled: [{ legs: 3 }, { legs: 3 }] });
		expect(
			(await compareScreen(other.deps, request("wealth"))).report.skipped,
		).toBe("moving");
		const unrelated = world({ pulled: [{ legs: 3 }] });
		expect(
			(await compareScreen(unrelated.deps, request("insights"))).report.state,
		).toBe("checked");
	});

	// ARS holds no value of its own in EUR: a missing rate reads unavailable,
	// not an amount. Null on both sides agrees, null on one side only is a
	// difference, never zero.
	it("holds a missing rate as a match on both sides and a difference on one", async () => {
		const noRate = ledger({ rates: false });
		const both = await compareScreen(
			world({ store: noRate, server: { ...HOME_SERVER, "glance.spent": null } })
				.deps,
			request("home"),
		);
		expect(both.report.differs).toEqual([]);
		const deviceOnly = await compareScreen(
			world({ store: noRate }).deps,
			request("home"),
		);
		expect(deviceOnly.report.differs).toEqual(["glance.spent"]);
		const serverOnly = await compareScreen(
			world({ server: { ...HOME_SERVER, "glance.spent": null } }).deps,
			request("home"),
		);
		expect(serverOnly.report.differs).toEqual(["glance.spent"]);
	});

	it("tells a stale rate table from a bug", async () => {
		const w = world({
			server: { ...HOME_SERVER, "glance.spent": eur(13_243) },
			ratesAsOf: "R0",
		});
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report).toMatchObject({ ratesMoved: 1, differs: [] });
		expect(report.classes["glance.spent"]).toBe("rates_moved");
	});

	it.each([
		["home currency", { home: "ARS" }],
		["zone", { timeZone: "America/Argentina/Buenos_Aires" }],
		["start day", { startDay: 15 }],
	])(
		"skips on a different %s, after the pull that fixes it",
		async (_name, setting) => {
			const w = world(setting);
			const { report } = await compareScreen(w.deps, request("home"));
			expect(report).toMatchObject({
				state: "skipped",
				skipped: "settings_differ",
				differs: [],
			});
			expect(w.events).toEqual(["server", "pull"]);
		},
	);

	it("skips with no basis after one call, and with no device reading or a failed pull", async () => {
		const w = world({ basis: null });
		const { report } = await compareScreen(
			w.deps,
			request("insights", {
				values: { categoryId: ["c1"], month: ["2026-11"] },
			}),
		);
		expect(report).toMatchObject({ state: "skipped", skipped: "no_basis" });
		expect(w.serverQueries).toHaveLength(1);

		const none = await compareScreen(
			world({ device: "none" }).deps,
			request("home"),
		);
		expect(none.report).toMatchObject({
			state: "skipped",
			skipped: "no_device",
		});
		const failed = await compareScreen(
			world({ pulled: [null] }).deps,
			request("home"),
		);
		expect(failed.report).toMatchObject({
			state: "skipped",
			skipped: "no_device",
		});
	});

	it("pulls from the lowest position the server's calls read at, which is the first", async () => {
		const w = world({
			bases: [100, 101, 102].map((t) => ({
				...BASIS,
				asOf: cursor(String(t)),
			})),
		});
		await compareScreen(
			w.deps,
			request("insights", { values: { categoryId: ["c1", "c2"] } }),
		);
		expect(w.serverQueries).toHaveLength(3);
		expect(w.pastArgs).toEqual([cursor("100")]);
	});

	it("reads the device at the server's instant, not its own clock", async () => {
		// The server read at 00:30Z on Dec 1 would be a period edge; read at
		// 06:00Z, this month is December: Spent is 0 and Spent last month is
		// e1 + e2 = 90.00 + 45.00 = EUR 135.00. A device clock a day behind,
		// Nov 30, would read November.
		const w = world({
			store: ledger({ e2: true }),
			basis: { ...BASIS, at: "2026-12-01T06:00:00.000Z" },
			deviceNow: "2026-11-30T06:00:00.000Z",
			server: {
				...HOME_SERVER,
				"glance.spent": eur(0),
				"glance.spentLast": eur(13_500),
			},
		});
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report.differs).toEqual([]);
		expect(report.classes["glance.spent"]).toBe("match");
		expect(w.deviceQueries[0]?.at.toISOString()).toBe(
			"2026-12-01T06:00:00.000Z",
		);
	});

	// The server's figures read their own clock a moment after basis.at, so a
	// read within a minute of midnight in the basis zone is not compared.
	it.each([
		[
			"UTC, 30 s before midnight",
			"2026-11-30T23:59:30.000Z",
			"UTC",
			"period_edge",
		],
		[
			"UTC, 30 s after midnight",
			"2026-12-01T00:00:30.000Z",
			"UTC",
			"period_edge",
		],
		["UTC, 2 min before midnight", "2026-11-30T23:58:00.000Z", "UTC", null],
		["UTC, 2 min after midnight", "2026-12-01T00:02:00.000Z", "UTC", null],
		[
			"Buenos Aires, 30 s before midnight",
			"2026-12-01T02:59:30.000Z",
			"America/Argentina/Buenos_Aires",
			"period_edge",
		],
		[
			"Buenos Aires, 30 s after midnight",
			"2026-12-01T03:00:30.000Z",
			"America/Argentina/Buenos_Aires",
			"period_edge",
		],
		[
			"Buenos Aires, UTC midnight is evening",
			"2026-12-01T00:00:30.000Z",
			"America/Argentina/Buenos_Aires",
			null,
		],
	])("%s", async (_n, instant, zone, skipped) => {
		const w = world({
			basis: { ...BASIS, at: instant, timeZone: zone },
			timeZone: zone,
		});
		const { report } = await compareScreen(w.deps, request("settings"));
		expect(report.skipped).toBe(skipped);
		expect(report.state).toBe(skipped ? "skipped" : "checked");
		// Skipped before the device is read.
		if (skipped) expect(w.events).not.toContain("device");
	});

	// Budget figures read in the book's zone, which can differ from settings:
	// 02:59:30Z is 23:59:30 in Buenos Aires but mid-night in UTC.
	it("skips at the budget book's midnight when it is not the settings zone's", async () => {
		const edge = "2026-12-01T02:59:30.000Z";
		const budget = world({
			basis: { ...BASIS, at: edge },
			bookZone: "America/Argentina/Buenos_Aires",
		});
		expect(
			(await compareScreen(budget.deps, request("budget"))).report.skipped,
		).toBe("period_edge");
		// A screen that reads no book is not held back by it.
		const wealth = world({
			basis: { ...BASIS, at: edge },
			bookZone: "America/Argentina/Buenos_Aires",
		});
		expect(
			(await compareScreen(wealth.deps, request("wealth"))).report.state,
		).toBe("checked");
	});

	it("skips as zone_unknown, never rejects, on a zone the runtime cannot format", async () => {
		const basis = world({
			basis: { ...BASIS, timeZone: "Mars/Olympus" },
			timeZone: "Mars/Olympus",
		});
		expect(
			(await compareScreen(basis.deps, request("home"))).report.skipped,
		).toBe("zone_unknown");
		const book = world({ bookZone: "Mars/Olympus" });
		expect(
			(await compareScreen(book.deps, request("budget"))).report.skipped,
		).toBe("zone_unknown");
	});

	it("compares the browser zone by canonical name, not by spelling", async () => {
		const spelled = world({
			basis: { ...BASIS, timeZone: "America/Argentina/Buenos_Aires" },
			timeZone: "America/Argentina/Buenos_Aires",
		});
		expect(
			(
				await compareScreen(
					spelled.deps,
					request("home", { browserZone: "America/Buenos_Aires" }),
				)
			).report.zone,
		).toBe("same");
		const other = await compareScreen(
			world().deps,
			request("home", { browserZone: "America/Argentina/Buenos_Aires" }),
		);
		expect(other.report.zone).toBe("differs");
		const junk = await compareScreen(
			world().deps,
			request("home", { browserZone: "Not/AZone" }),
		);
		expect(junk.report.zone).toBe("differs");
	});
});

const VERDICT: VerdictView = {
	bookId: "b",
	currency: "ARS",
	month: 202611,
	today: "2026-11-15",
	style: "SAVE_FIRST",
	incomplete: false,
	state: "ON_TRACK",
	action: null,
	lead: {
		figureId: "budget.leftToSpend",
		amount: { minor: 100, currency: "ARS" },
	},
};
const OFF: VerdictView = {
	...VERDICT,
	lead: { ...VERDICT.lead, amount: { minor: 101, currency: "ARS" } },
};

describe("the verdict as a unit", () => {
	it("reads the server's verdict in the figures' window and names the parts", async () => {
		const same = world({ verdict: VERDICT });
		const ok = await compareScreen(
			same.deps,
			request("home", { serverVerdict: async () => VERDICT }),
		);
		expect(ok.report).toMatchObject({ keys: 7, of: 7, differs: [] });
		expect(ok.report.classes.verdict).toBe("match");

		const events: string[] = [];
		const w = world({ verdict: VERDICT });
		const { report } = await compareScreen(
			w.deps,
			request("home", {
				serverVerdict: async () => {
					events.push(...w.events);
					return OFF;
				},
			}),
		);
		// The verdict is read after the server's figures and before the pull.
		expect(events).toEqual(["server"]);
		expect(report.differs).toEqual(["verdict"]);
		expect(report.verdictParts).toEqual(["amount"]);
	});

	// A verdict that differs while the pull stopped below the read is lag; one
	// that differs with the pull complete is a difference.
	it("classes the verdict with the figures' position", async () => {
		const behind = world({ verdict: VERDICT, cursorT: "90" });
		const lag = await compareScreen(
			behind.deps,
			request("home", { serverVerdict: async () => OFF }),
		);
		expect(lag.report.classes.verdict).toBe("behind");
		const rates = world({ verdict: VERDICT, ratesAsOf: "R0" });
		expect(
			(
				await compareScreen(
					rates.deps,
					request("home", { serverVerdict: async () => OFF }),
				)
			).report.classes.verdict,
		).toBe("rates_moved");
	});

	it("leaves the verdict out when the screen has none or it is not comparable", async () => {
		const none = await compareScreen(
			world({ verdict: VERDICT }).deps,
			request("home"),
		);
		expect(none.report.classes.verdict).toBeUndefined();
		const other = await compareScreen(
			world({ verdict: VERDICT }).deps,
			request("home", {
				serverVerdict: async () => ({ ...VERDICT, today: "2026-11-16" }),
			}),
		);
		expect(other.report).toMatchObject({ keys: 6, differs: [] });
		// A screen with no verdict never asks for one.
		let asked = 0;
		await compareScreen(
			world().deps,
			request("wealth", {
				serverVerdict: async () => {
					asked += 1;
					return VERDICT;
				},
			}),
		);
		expect(asked).toBe(0);
	});
});

describe("narrowing reaches both sides", () => {
	it("sends each narrowing value to the server and the device, one call per value", async () => {
		const w = world({
			server: Object.fromEntries(DEVICE_FIGURE_IDS.map((id) => [id, null])),
		});
		await compareScreen(
			w.deps,
			request("insights", {
				values: { categoryId: ["c1", "c2"], month: ["2026-11"] },
			}),
		);
		const narrowed = w.serverQueries.slice(1, 4);
		expect(narrowed).toEqual([
			{
				ids: "insights.byCategory,insights.ytdByCategory,insights.ytdByCategoryUsd",
				categoryId: "c1",
			},
			{
				ids: "insights.byCategory,insights.ytdByCategory,insights.ytdByCategoryUsd",
				categoryId: "c2",
			},
			{ ids: "insights.byMonth", month: "2026-11" },
		]);
		expect(w.deviceQueries.slice(1, 4).map((q) => q.narrowing)).toEqual([
			{ categoryId: "c1" },
			{ categoryId: "c2" },
			{ month: "2026-11" },
		]);
	});
});

describe("the request plan", () => {
	const values = (n: number) => ({
		categoryId: Array.from({ length: n }, (_, i) => `c${i}`),
		month: Array.from(
			{ length: 14 },
			(_, i) => `2026-${String(i + 1).padStart(2, "0")}`,
		),
	});

	it("asks every plain id in one call of at most 50, then one call per value", () => {
		const plan = planCheck(SCREENS.insights, { categoryId: ["a", "b"] });
		expect(plan.calls[0]?.ids).toEqual(SCREENS.insights.plain);
		expect(plan.calls[0]?.narrowing).toEqual({});
		expect(plan.calls).toHaveLength(3);
		expect(plan.of).toBe(SCREENS.insights.plain.length + 6);
		expect(() =>
			planCheck(
				{
					...SCREENS.insights,
					plain: Array.from(
						{ length: MAX_IDS_PER_CALL + 1 },
						(_, i) => `a${i}`,
					),
				},
				{},
			),
		).toThrow();
	});

	it("makes at most six narrowed calls and covers every value within ceil(n / 6) checks", () => {
		const all = values(5); // 5 categories + 14 months = 19 calls
		const n = 19;
		const seen = new Set<string>();
		let start = 0;
		for (let check = 0; check < Math.ceil(n / MAX_NARROWED_CALLS); check += 1) {
			const plan = planCheck(SCREENS.insights, all, start);
			expect(plan.calls.length - 1).toBeLessThanOrEqual(MAX_NARROWED_CALLS);
			for (const call of plan.calls.slice(1))
				for (const id of call.ids)
					seen.add(keyOf(id, Object.values(call.narrowing)[0]));
			start = plan.next;
		}
		const every = [
			...all.categoryId.flatMap((c) =>
				[
					"insights.byCategory",
					"insights.ytdByCategory",
					"insights.ytdByCategoryUsd",
				].map((id) => keyOf(id, c)),
			),
			...all.month.map((m) => keyOf("insights.byMonth", m)),
		];
		expect([...seen].sort()).toEqual(every.sort());
	});

	it("wraps the rotation and takes everything in one check when it fits", () => {
		const few = planCheck(
			SCREENS.insights,
			{ month: ["2026-10", "2026-11"] },
			5,
		);
		expect(few.calls).toHaveLength(3);
		expect(few.next).toBe(0);
		const many = planCheck(SCREENS.insights, values(0), 12);
		// 14 values from index 12: 12, 13, 0, 1, 2, 3, then the next check starts at 4.
		expect(many.calls.slice(1).map((c) => c.narrowing.month)).toEqual([
			"2026-13",
			"2026-14",
			"2026-01",
			"2026-02",
			"2026-03",
			"2026-04",
		]);
		expect(many.next).toBe(4);
	});
});

describe("keys", () => {
	it("formats and parses an id and a narrowing value, colons in the value included", () => {
		expect(keyOf("netWorth")).toBe("netWorth");
		expect(parseKey("netWorth")).toEqual({ id: "netWorth" });
		expect(keyOf("envelope.left", "shared:abc")).toBe(
			"envelope.left:shared:abc",
		);
		expect(parseKey("envelope.left:shared:abc")).toEqual({
			id: "envelope.left",
			value: "shared:abc",
		});
	});
});

describe("sameLines", () => {
	const ars = (minor: number) => ({ minor, currency: "ARS" });
	it("compares minor units, currency and order exactly", () => {
		expect(sameLines([ars(1)], [ars(1)])).toBe(true);
		expect(sameLines([ars(1)], [ars(2)])).toBe(false);
		expect(sameLines([ars(1)], [{ minor: 1, currency: "USD" }])).toBe(false);
		expect(
			sameLines(
				[ars(1), { minor: 1, currency: "USD" }],
				[{ minor: 1, currency: "USD" }, ars(1)],
			),
		).toBe(false);
		expect(sameLines([], [ars(0)])).toBe(false);
	});
	it("treats unavailable on both sides as a match and on one side as a difference", () => {
		expect(sameLines(null, null)).toBe(true);
		expect(sameLines(undefined, null)).toBe(true);
		expect(sameLines(null, [ars(0)])).toBe(false);
		expect(sameLines([ars(0)], null)).toBe(false);
		expect(sameLines(null, [])).toBe(false);
	});
});

describe("verdictParts", () => {
	const v = (o: Partial<VerdictView> = {}): VerdictView => ({
		bookId: "b",
		currency: "ARS",
		month: 202611,
		today: "2026-11-15",
		style: "SAVE_FIRST",
		incomplete: false,
		state: "ON_TRACK",
		action: null,
		lead: {
			figureId: "budget.leftToSpend",
			amount: { minor: 100, currency: "ARS" },
		},
		...o,
	});
	it("names what differs", () => {
		expect(verdictParts(v(), v())).toEqual([]);
		expect(
			verdictParts(
				v(),
				v({
					state: "OVER_BUDGET",
					action: "COVER",
					lead: {
						figureId: "budget.leftInLimits",
						amount: { minor: 101, currency: "ARS" },
					},
				}),
			),
		).toEqual(["state", "action", "figure", "amount"]);
		expect(
			verdictParts(
				v(),
				v({
					lead: {
						figureId: "budget.leftToSpend",
						amount: { minor: 100, currency: "USD" },
					},
				}),
			),
		).toEqual(["amount"]);
	});
	it.each([
		["another book", { bookId: "c" }],
		["another currency", { currency: "USD" }],
		["another month", { month: 202612 }],
		["another day", { today: "2026-11-16" }],
		["another style", { style: "FLEX" }],
		["incomplete", { incomplete: true }],
		["Pay off debt", { style: "DEBT_PAYOFF" }],
	])("is not comparable for %s", (_n, o) => {
		expect(verdictParts(v(), v(o))).toBeNull();
		expect(verdictParts(v(o), v())).toBeNull();
	});
});

describe("compareLine", () => {
	it("carries ids and counts in fixed keys and never an amount", async () => {
		// Both sides hold the sentinel and differ in it; neither may reach the line.
		const SENTINEL = 987654321;
		const w = world({
			server: { ...HOME_SERVER, "glance.spent": eur(SENTINEL) },
			store: ledger(),
		});
		const { report } = await compareScreen(w.deps, request("home"));
		expect(report.differs).toEqual(["glance.spent"]);
		const line = compareLine(report);
		expect(line).not.toContain(String(SENTINEL));
		expect(line).not.toContain("9000");
		expect(JSON.stringify(report)).not.toContain(String(SENTINEL));
		expect(Object.keys(JSON.parse(line))).toEqual([
			"screen",
			"state",
			"keys",
			"of",
			"differs",
			"behind",
			"ratesMoved",
			"skipped",
			"generation",
			"zone",
			"clock",
		]);
		expect(JSON.parse(line)).toMatchObject({
			screen: "home",
			state: "checked",
			keys: 6,
			of: 6,
			differs: ["glance.spent"],
			skipped: null,
			zone: "same",
			clock: NOON,
		});
	});
});

describe("positionReached", () => {
	const entities = ["expenses", "accounts"];
	const both = (t: string, e = "e1") => ({
		expenses: cursor(t, e),
		accounts: cursor(t, e),
	});
	it("reaches a position every entity is at or past", () => {
		expect(positionReached(both("100"), entities, cursor("100"))).toBe(
			"reached",
		);
		expect(positionReached(both("99"), entities, cursor("100"))).toBe("behind");
		// Positions compare as numbers: 9 is below 10, though "9" > "10" as text.
		expect(positionReached(both("9"), entities, cursor("10"))).toBe("behind");
		// Past the read is still reached: positions are cluster-wide.
		expect(positionReached(both("100"), entities, cursor("99"))).toBe(
			"reached",
		);
	});
	it("is behind when one entity lags, has no cursor or has another epoch", () => {
		expect(
			positionReached(
				{ ...both("100"), accounts: cursor("50") },
				entities,
				cursor("100"),
			),
		).toBe("behind");
		expect(
			positionReached({ expenses: cursor("100") }, entities, cursor("100")),
		).toBe("behind");
		expect(positionReached(both("100", "e2"), entities, cursor("100"))).toBe(
			"behind",
		);
	});
	it("fails closed on a reset entity and a malformed position", () => {
		expect(
			positionReached(
				{ ...both("100"), accounts: SYNC_RESET },
				entities,
				cursor("100"),
			),
		).toBe("reset");
		expect(positionReached(both("100"), entities, "not a cursor")).toBe(
			"malformed",
		);
	});
});

describe("the screens", () => {
	const specs = Object.entries(SCREENS) as [
		ScreenName,
		(typeof SCREENS)[ScreenName],
	][];
	const NARROW_VALUE: Record<Narrow, string> = {
		accountId: "accounts-1",
		categoryId: "categories-1",
		envelopeId: "envelopes-1",
		month: "2026-11",
		recurringId: "recurringTemplates-1",
	};
	const SINGLE: Partial<Record<TableName, string>> = {
		settings: SETTINGS_ID,
		rateSync: RATE_SYNC_ID,
		owed: OWED_ID,
		budgetSnapshot: BUDGET_SNAPSHOT_ID,
		budgetSnapshotPending: BUDGET_SNAPSHOT_ID,
	};

	it("builds every id from the device registry, with no server-only id and one narrowing at most", () => {
		for (const [name, spec] of specs) {
			const all = [...spec.plain, ...Object.keys(spec.narrowed)];
			expect(all.length, name).toBeGreaterThan(0);
			expect(spec.plain.length, name).toBeLessThanOrEqual(MAX_IDS_PER_CALL);
			for (const id of all) {
				expect(DEVICE_FIGURE_IDS, `${name} ${id}`).toContain(id);
				expect(serverOnlyReason(id), `${name} ${id}`).toBeUndefined();
			}
			expect(new Set(all).size, name).toBe(all.length);
		}
		expect(SCREENS.home.plain).toEqual([
			"glance.spent",
			"glance.spentLastToDate",
			"glance.spentLast",
			"glance.moneyIn",
			"netWorth",
			"budget.notPlannedYet",
		]);
		expect(SCREENS.budget.narrowed).toEqual({
			"envelope.left": "envelopeId",
			"envelope.spent": "envelopeId",
		});
		expect(SCREENS.wealth.narrowed).toEqual({
			"accounts.balance": "accountId",
		});
		expect(SCREENS.recurring.narrowed).toEqual({
			"recurring.amount": "recurringId",
		});
		expect(SCREENS.insights.narrowed).toEqual({
			"insights.byCategory": "categoryId",
			"insights.ytdByCategory": "categoryId",
			"insights.ytdByCategoryUsd": "categoryId",
			"insights.byMonth": "month",
		});
	});

	// A narrowed id read with no narrowing throws or reads nothing, or (a
	// balance with no account is the total of all) reads differently from a
	// narrowing no row has; a plain id never throws for a missing one.
	it("holds the plain ids to reading with no narrowing and the narrowed ones to needing one", async () => {
		const store = ledger({ account: true });
		const readWith = async (id: string, narrowing: Record<string, string>) => {
			try {
				return (
					await readDeviceFigures(store, "u1", [id], narrowing)
				).readings.get(id);
			} catch (error) {
				if (error instanceof FigureNarrowingError) return "needs a narrowing";
				// Any other failure is the fixture's (no book), not a narrowing.
				return undefined;
			}
		};
		for (const [name, spec] of specs) {
			for (const id of spec.plain) {
				expect(await readWith(id, {}), `${name} ${id}`).not.toBe(
					"needs a narrowing",
				);
			}
		}
		const narrowed = new Map(
			specs.flatMap(([, s]) => Object.entries(s.narrowed)),
		);
		for (const [id, kind] of narrowed) {
			const bare = await readWith(id, {});
			const none = await readWith(id, { [kind]: "no such row" });
			expect(
				bare === "needs a narrowing" ||
					bare === null ||
					!sameLines(bare as never, none as never),
				id,
			).toBe(true);
		}
	});

	// Every table a screen's figures read is one of its sync entities or is
	// filled by a step other than a cursor pull (settings, the shares snapshot,
	// the rate table); a figure that reads another table would be compared
	// before its rows had caught up.
	it("lists every sync entity the figures of a screen read", async () => {
		const pulled: Record<string, string> = {};
		await pullAll(ledger(), fakeDeviceApi().api, pulled);
		const entities = new Set(Object.keys(pulled));
		expect(entities.size).toBeGreaterThan(10);

		const rows: Record<string, unknown[]> = {};
		for (const t of TABLE_NAMES)
			if (t !== "budgetReset") rows[t] = [fixtureRow(t, SINGLE[t] ?? `${t}-1`)];
		const book = syncedBook(new MemoryStore({ rows: rows as never }));
		rows.budgetSnapshot = [
			{
				...fixtureRow("budgetSnapshot", BUDGET_SNAPSHOT_ID),
				bookId: book?.id,
				valuationKey: book?.key,
			},
		];
		const store = new MemoryStore({ rows: rows as never });

		for (const [name, spec] of specs) {
			const read = new Set<string>();
			const db: Reader = {
				get: (t, id) => (read.add(t), store.get(t, id)),
				list: (t) => (read.add(t), store.list(t)),
			};
			const calls = [
				{ ids: spec.plain, narrowing: {} as Record<string, string> },
				...Object.entries(spec.narrowed).map(([id, kind]) => ({
					ids: [id],
					narrowing: { [kind]: NARROW_VALUE[kind] },
				})),
			];
			for (const call of calls)
				await readDeviceFigures(db, "u1", call.ids, call.narrowing, () =>
					at(NOON),
				).catch(() => undefined);
			const missing = [...read].filter(
				(t) => entities.has(t) && !spec.entities.includes(t),
			);
			expect(missing, name).toEqual([]);
			expect(read.size, name).toBeGreaterThan(0);
		}
	});
});

describe("pastPosition", () => {
	it("is true only for a cursor strictly past the position, and for any doubt", () => {
		expect(pastPosition(cursor("101"), cursor("100"))).toBe(true);
		expect(pastPosition(cursor("100"), cursor("100"))).toBe(false);
		expect(pastPosition(cursor("99"), cursor("100"))).toBe(false);
		// As numbers, not text: 10 is past 9.
		expect(pastPosition(cursor("10"), cursor("9"))).toBe(true);
		expect(pastPosition(cursor("50", "e2"), cursor("100"))).toBe(true);
		expect(pastPosition("not a cursor", cursor("100"))).toBe(true);
		expect(pastPosition(cursor("50"), "not a cursor")).toBe(true);
	});
});

// The pull counts what it brought in past the read: pages ending past A hold
// every row stamped after A, so zero is proof that none arrived. The server
// double pages the way the real one does: a page that has more ends at its
// last stamp, the last page ends at the cut.
describe("what the pull brings in past a read", () => {
	const page = (n: number, t: string, hasMore = false) => ({
		items: Array.from({ length: n }, (_, i) =>
			wireExpense(`x${t}-${i}`, "10", "2026-11-10T12:00:00.000Z"),
		),
		tombstones: [],
		cursor: cursor(t),
		hasMore,
	});
	const pullPast = async (pages: ReturnType<typeof page>[], past: string) => {
		const { api } = fakeDeviceApi({ expensePages: pages });
		const report = await pullAll(new MemoryStore(), api, {}, { past });
		return report.entities.expenses?.past;
	};

	it("is zero when every page ends at or below the read, though a later cut moved on", async () => {
		// Rows stamped 90 and 100, read at 100: nothing newer arrived.
		expect(await pullPast([page(2, "100")], cursor("100"))).toBe(0);
		expect(
			await pullPast([page(3, "90", true), page(2, "100")], cursor("100")),
		).toBe(0);
	});

	it("counts the rows of pages that end past the read, a bound on the rows stamped after it", async () => {
		// A last page at cut 107 holds a row stamped 105 (another user's write
		// moved the cut, this user's row came with it).
		expect(await pullPast([page(2, "107")], cursor("100"))).toBe(2);
		expect(
			await pullPast([page(3, "90", true), page(1, "107")], cursor("100")),
		).toBe(1);
		expect(await pullPast([page(0, "107")], cursor("100"))).toBe(0);
	});

	it("reports nothing unless asked", async () => {
		const { api } = fakeDeviceApi({ expensePages: [page(1, "107")] });
		const report = await pullAll(new MemoryStore(), api, {});
		expect(report.entities.expenses?.past).toBeUndefined();
	});
});

describe("edgeOf", () => {
	it("checks every zone and names an unreadable one without throwing", () => {
		const nearBa = at("2026-12-01T02:59:30.000Z");
		expect(edgeOf(nearBa, ["UTC"])).toBeNull();
		expect(edgeOf(nearBa, ["UTC", "America/Argentina/Buenos_Aires"])).toBe(
			"period_edge",
		);
		expect(edgeOf(nearBa, ["UTC", "Mars/Olympus"])).toBe("zone_unknown");
		expect(edgeOf(nearBa, [])).toBeNull();
	});
});

describe("no hand copies", () => {
	it("takes the Wealth ids from their one owner", () => {
		expect(
			SCREENS.wealth.plain.length + Object.keys(SCREENS.wealth.narrowed).length,
		).toBe(WEALTH_FIGURE_IDS.length);
		for (const id of WEALTH_FIGURE_IDS) expect(DEVICE_FIGURE_IDS).toContain(id);
	});
});

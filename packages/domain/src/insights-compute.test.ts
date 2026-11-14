/**
 * The shared Insights compute, with every expected value derived by hand. The
 * server runs it over SQL rows (src/server/services/insights); the same
 * rules on a real Postgres are pinned by characterization.pg.test.ts there.
 */
import { describe, expect, it } from "vitest";
import {
	averageOf,
	cashflowOf,
	daysElapsed,
	groupByCategory,
	insightsContextOf,
	instantRange,
	monthBarsOf,
	monthsWindow,
	previousPeriod,
	savedOf,
	spanRate,
	spanReadOf,
	valueIn,
	ytdSideOf,
} from "./insights-compute";
import type { RateRow } from "./money";
import { dec } from "./precise-decimal";
import type { SpentItem } from "./spent";

const ZONE = "America/Argentina/Buenos_Aires";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ctx = (rateRows: readonly RateRow[], now = "2026-10-15T15:00:00Z") =>
	insightsContextOf({
		home: "ARS",
		zone: ZONE,
		startDay: 1,
		now: new Date(now),
		rateRows,
	});

describe("insightsContextOf", () => {
	const rows: RateRow[] = [
		{ type: "blue", rate: 1400, date: day("2025-12-20") },
		{ type: "official", rate: 1000, date: day("2026-10-05") },
		{ type: "blue", rate: 1500, date: day("2026-10-05") },
	];

	it("picks by the rate's own date: blue on or before it wins, else the nearest after", () => {
		const c = ctx(rows);
		// Before every row: blue's nearest after (1,400) beats official's (1,000).
		expect(c.homeRateAt(day("2025-06-01"))).toBe(1400);
		// Oct 4: blue Dec 20 is the latest on or before; official Oct 5 is after.
		expect(c.homeRateAt(day("2026-10-04"))).toBe(1400);
		expect(c.homeRateAt(day("2026-10-05"))).toBe(1500);
	});

	it("reads every row, not a window: a stale blue row behind 25 newer official ones still wins", () => {
		const newer: RateRow[] = Array.from({ length: 25 }, (_, i) => ({
			type: "official",
			rate: 1000 + i,
			date: day(`2026-02-${String(i + 1).padStart(2, "0")}`),
		}));
		const stale: RateRow = {
			type: "blue",
			rate: 1300,
			date: day("2026-01-01"),
		};
		expect(ctx([stale, ...newer]).homeRateAt(day("2026-03-01"))).toBe(1300);
	});

	it("USD is 1 without rows, any other home without rows has no rate", () => {
		const usd = insightsContextOf({
			home: "USD",
			zone: ZONE,
			startDay: 1,
			now: new Date("2026-10-15T15:00:00Z"),
			rateRows: [],
		});
		expect(usd.homeRateAt(day("2026-10-01"))).toBe(1);
		expect(ctx([]).homeRateAt(day("2026-10-01"))).toBeNull();
	});
});

describe("spanRate", () => {
	const c = ctx([
		{ type: "blue", rate: 1400, date: day("2025-12-20") },
		{ type: "blue", rate: 1500, date: day("2026-10-05") },
	]);

	it("a span that ended converts at its end", () => {
		// September ends Sep 30 23:59:59.999 local (Oct 1 02:59Z): Oct 5 is after.
		expect(spanRate(c, { from: "2026-09-01", to: "2026-09-30" })).toBe(1400);
	});

	it("a span that runs past now converts at now", () => {
		// Oct 31 is after Oct 15 15:00Z; the Oct 5 row is on or before now.
		expect(spanRate(c, { from: "2026-10-01", to: "2026-10-31" })).toBe(1500);
	});
});

describe("instantRange", () => {
	it("is the first midnight to the last millisecond in the zone", () => {
		const { gte, lte } = instantRange(
			{ from: "2026-10-01", to: "2026-10-31" },
			ZONE,
		);
		expect(gte.toISOString()).toBe("2026-10-01T03:00:00.000Z");
		expect(lte.toISOString()).toBe("2026-11-01T02:59:59.999Z");
	});
});

describe("previousPeriod", () => {
	it("a fiscal period meets the one before it, whatever its length", () => {
		expect(
			previousPeriod(
				{ zone: ZONE, startDay: 15 },
				{ from: "2026-10-15", to: "2026-11-14" },
			),
		).toEqual({ from: "2026-09-15", to: "2026-10-14" });
		expect(
			previousPeriod(
				{ zone: ZONE, startDay: 1 },
				{ from: "2026-03-01", to: "2026-03-31" },
			),
		).toEqual({ from: "2026-02-01", to: "2026-02-28" });
	});

	it("any other span is the same number of days right before it", () => {
		// Oct 10 to Oct 20 is 11 days: Sep 29 to Oct 9.
		expect(
			previousPeriod(
				{ zone: ZONE, startDay: 1 },
				{ from: "2026-10-10", to: "2026-10-20" },
			),
		).toEqual({ from: "2026-09-29", to: "2026-10-09" });
	});
});

describe("valueIn", () => {
	const item = (amount: string, amountInUSD: string, currency = "USD") => ({
		currency,
		amount: dec(amount),
		amountInUSD: dec(amountInUSD),
		booked: null,
	});

	it("totals stored USD values at the rate, rounded once", () => {
		// 10.00 + 0.07 USD = 10.07 x 1,500 = 15,105.00 ARS.
		expect(
			valueIn([item("10", "10"), item("0.07", "0.07")], "ARS", 1500),
		).toEqual({ money: { minor: 1_510_500, currency: "ARS" }, missing: [] });
	});

	it("names home when there is no rate, never uses 1", () => {
		expect(valueIn([item("10", "10")], "ARS", null)).toEqual({
			money: null,
			missing: ["ARS"],
		});
	});
});

/** Home "ARS": blue 1,400 from Dec 20, 2025, blue 1,500 from Oct 5, 2026; now Oct 15. */
const ratedCtx = () =>
	ctx([
		{ type: "blue", rate: 1400, date: day("2025-12-20") },
		{ type: "blue", rate: 1500, date: day("2026-10-05") },
	]);

const spent = (
	amount: string,
	o: Partial<SpentItem> & { usd?: string } = {},
): SpentItem => ({
	currency: "ARS",
	amount: dec(amount),
	amountInUSD: dec(o.usd ?? "0"),
	booked: null,
	categoryId: null,
	date: null,
	count: 1,
	...o,
});
const usdRow = (amount: string, o: Partial<SpentItem> = {}) =>
	spent(amount, { currency: "USD", usd: amount, ...o });

describe("groupByCategory", () => {
	it("keeps the first-seen order of categories, null among them", () => {
		const a = spent("1", { categoryId: "food" });
		const b = spent("2");
		const c = spent("3", { categoryId: "food" });
		const groups = groupByCategory([a, b, c]);
		expect([...groups.keys()]).toEqual(["food", null]);
		expect(groups.get("food")).toEqual([a, c]);
		expect(groups.get(null)).toEqual([b]);
	});
});

describe("spanReadOf", () => {
	const october = { from: "2026-10-01", to: "2026-10-31" };

	it("totals at the span's rate, a booked row at its booked value, a refund is no expense", () => {
		const read = spanReadOf(
			[
				usdRow("10", { categoryId: "food" }),
				usdRow("10", {
					categoryId: "food",
					booked: { currency: "ARS", amount: dec("14500") },
				}),
				spent("-2000", { categoryId: "food", count: 0 }),
				spent("100"),
			],
			ratedCtx(),
			october,
		);
		// Food: 10 x 1,500 + 14,500 - 2,000 = 27,500; uncategorized 100; total 27,600.
		expect(read.total.money).toEqual({ minor: 2_760_000, currency: "ARS" });
		expect(read.categories.get("food")?.money).toEqual({
			minor: 2_750_000,
			currency: "ARS",
		});
		expect(read.categories.get(null)?.money).toEqual({
			minor: 10_000,
			currency: "ARS",
		});
		// Three expenses; the refund counts 0.
		expect(read.count).toBe(3);
	});

	it("an unpriced share names its currency and leaves the total out", () => {
		const read = spanReadOf(
			[
				{
					currency: "XQZ",
					amount: dec("10"),
					amountInUSD: null,
					rate: null,
					categoryId: null,
					date: null,
					count: 1,
				},
			],
			ratedCtx(),
			october,
		);
		expect(read.total).toEqual({ money: null, missing: ["XQZ"] });
	});
});

describe("ytdSideOf", () => {
	it("home at the span's rate, USD at the frozen values, a share at its own rate", () => {
		const side = ytdSideOf(
			[
				usdRow("10", { categoryId: "food" }),
				{
					currency: "TRY",
					amount: dec("900"),
					amountInUSD: dec("22.5"),
					rate: dec("40"),
					categoryId: "food",
					date: null,
					count: 1,
				},
			],
			ratedCtx(),
			{ from: "2026-01-01", to: "2026-10-15" },
		);
		// Home: 10 x 1,500 + 900 / 40 x 1,500 = 15,000 + 33,750 = 48,750.00.
		// USD: 10 + 22.50 = 32.50.
		const expected = {
			home: { minor: 4_875_000, currency: "ARS" },
			usd: { minor: 3_250, currency: "USD" },
		};
		expect(side.total).toEqual(expected);
		expect(side.categories.get("food")).toEqual(expected);
		expect(side.missing).toEqual([]);
	});
});

describe("months", () => {
	it("a window is the labels' fiscal months and the span that covers them", () => {
		const window = monthsWindow({ zone: ZONE, startDay: 1 }, [
			"2026-09",
			"2026-10",
		]);
		expect(window?.span).toEqual({ from: "2026-09-01", to: "2026-10-31" });
		expect(window?.ranges.map((r) => r.start.toISOString())).toEqual([
			"2026-09-01T03:00:00.000Z",
			"2026-10-01T03:00:00.000Z",
		]);
		expect(monthsWindow({ zone: ZONE, startDay: 1 }, [])).toBeNull();
	});

	it("a row falls into its month by its instant and each month converts at its own end", () => {
		const c = ratedCtx();
		const window = monthsWindow(c, ["2026-09", "2026-10"]);
		const { bars, missing } = monthBarsOf(
			[
				// Sep 30 23:59 local and Oct 1 00:00 local.
				spent("5", { date: new Date("2026-10-01T02:59:00Z") }),
				spent("7", { date: new Date("2026-10-01T03:00:00Z") }),
				usdRow("20", { date: new Date("2026-09-10T15:00:00Z") }),
				usdRow("10", { date: new Date("2026-10-10T15:00:00Z") }),
				// A row with no instant belongs to no month.
				spent("999"),
			],
			c,
			window?.ranges ?? [],
		);
		// September at its end's blue 1,400: 5 + 20 x 1,400 = 28,005.00.
		// October still runs: at now's blue 1,500: 7 + 10 x 1,500 = 15,007.00.
		expect(bars).toEqual([
			{
				month: "2026-09",
				span: { from: "2026-09-01", to: "2026-09-30" },
				total: { minor: 2_800_500, currency: "ARS" },
			},
			{
				month: "2026-10",
				span: { from: "2026-10-01", to: "2026-10-31" },
				total: { minor: 1_500_700, currency: "ARS" },
			},
		]);
		expect(missing).toEqual([]);
	});

	it("a home with no rate leaves the foreign month out and names home", () => {
		const c = ctx([]);
		const window = monthsWindow(c, ["2026-10"]);
		const { bars, missing } = monthBarsOf(
			[usdRow("10", { date: new Date("2026-10-10T15:00:00Z") })],
			c,
			window?.ranges ?? [],
		);
		expect(bars[0]?.total).toBeNull();
		expect(missing).toEqual(["ARS"]);
	});
});

describe("cashflow", () => {
	const m = (minor: number) => ({ minor, currency: "ARS" });

	it("income and spending at the range's rate, saved signed", () => {
		const read = cashflowOf([spent("100")], [usdRow("50")], ratedCtx(), {
			from: "2026-10-01",
			to: "2026-10-31",
		});
		// Income 50 x 1,500 = 75,000.00; spent 100.00; saved 74,900.00.
		expect(read.income).toEqual(m(7_500_000));
		expect(read.spent).toEqual(m(10_000));
		expect(savedOf(read)).toEqual(m(7_490_000));
		expect(savedOf({ ...read, income: null })).toBeNull();
		expect(savedOf({ ...read, spent: null })).toBeNull();
		expect(savedOf({ spent: m(500), income: m(0), missing: [] })).toEqual(
			m(-500),
		);
	});

	it("averages split half to even: an exact tie goes to the even neighbor", () => {
		expect(averageOf(m(5), 2)).toEqual(m(2));
		expect(averageOf(m(7), 2)).toEqual(m(4));
		expect(averageOf(m(-5), 2)).toEqual(m(-2));
		// 5,760,010 / 15 = 384,000.67.
		expect(averageOf(m(5_760_010), 15)).toEqual(m(384_001));
		expect(averageOf(null, 2)).toBeNull();
		expect(averageOf(m(5), 0)).toBeNull();
	});

	it("days elapsed stop at today, and a finished range counts all its days", () => {
		const october = { from: "2026-10-01", to: "2026-10-31" };
		const september = { from: "2026-09-01", to: "2026-09-30" };
		expect(daysElapsed(october, "2026-10-15")).toBe(15);
		expect(daysElapsed(september, "2026-10-15")).toBe(30);
	});
});

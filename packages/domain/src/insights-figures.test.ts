/**
 * The picks behind the insights.* figures, with every expected value derived
 * by hand. The rows come from a loader (the server's SQL or a device's store);
 * these tests hand the picks finished reads.
 */
import { describe, expect, it } from "vitest";
import { FigureUnavailable } from "./figures/unavailable";
import { insightsContextOf, type YtdSide } from "./insights-compute";
import {
	cashflowPicks,
	cashflowReading,
	categoryReading,
	insightsPeriod,
	insightsYtdSpans,
	monthReading,
	reading,
	spanReading,
	ytdReading,
} from "./insights-figures";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const usd = (minor: number) => ({ minor, currency: "USD" });
const ctxAt = (now: string, startDay = 1, zone = "America/Argentina/Buenos_Aires") =>
	insightsContextOf({
		home: "ARS",
		zone,
		startDay,
		now: new Date(now),
		rateRows: [],
	});

describe("insightsPeriod", () => {
	it("is the fiscal period holding now", () => {
		expect(insightsPeriod(ctxAt("2026-10-15T15:00:00Z"))).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
		});
		// Start day 15: Oct 15 starts a period, Oct 14 is the day before it ends.
		expect(insightsPeriod(ctxAt("2026-10-15T15:00:00Z", 15))).toEqual({
			from: "2026-10-15",
			to: "2026-11-14",
		});
		expect(insightsPeriod(ctxAt("2026-10-14T15:00:00Z", 15))).toEqual({
			from: "2026-09-15",
			to: "2026-10-14",
		});
	});

	it("reads the day in the zone: 02:30Z on Nov 1 is still October in Buenos Aires", () => {
		expect(insightsPeriod(ctxAt("2026-11-01T02:30:00Z"))).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(insightsPeriod(ctxAt("2026-11-01T03:30:00Z"))).toEqual({
			from: "2026-11-01",
			to: "2026-11-30",
		});
	});
});

describe("insightsYtdSpans", () => {
	it("January 1 to today against the same days last year, in the viewer's zone", () => {
		const now = "2027-01-01T03:30:00Z";
		// Buenos Aires (UTC-3): already Jan 1, 00:30.
		expect(insightsYtdSpans(ctxAt(now))).toEqual({
			thisYear: { from: "2027-01-01", to: "2027-01-01" },
			lastYear: { from: "2026-01-01", to: "2026-01-01" },
		});
		// New York (UTC-5): still Dec 31, 22:30.
		expect(insightsYtdSpans(ctxAt(now, 1, "America/New_York"))).toEqual({
			thisYear: { from: "2026-01-01", to: "2026-12-31" },
			lastYear: { from: "2025-01-01", to: "2025-12-31" },
		});
	});
});

describe("readings", () => {
	const missing = (r: unknown) => (r as FigureUnavailable).missingRates;

	it("a value is itself; a missing one is the marker naming each currency once, sorted", () => {
		expect(reading(ars(5), [])).toEqual(ars(5));
		const marker = reading(null, ["XQZ", "ARS", "XQZ"]);
		expect(marker).toBeInstanceOf(FigureUnavailable);
		expect(missing(marker)).toEqual(["ARS", "XQZ"]);
	});

	it("span: the total of the read", () => {
		const read = {
			total: { money: ars(100), missing: [] as const },
			count: 1,
			categories: new Map(),
		};
		expect(spanReading(read)).toEqual(ars(100));
		expect(
			missing(
				spanReading({
					...read,
					total: { money: null, missing: ["XQZ"] },
				}),
			),
		).toEqual(["XQZ"]);
	});

	it("category: its value, 0 in home when nothing is there, the marker when unpriced", () => {
		const read = {
			total: { money: ars(300), missing: [] as const },
			count: 2,
			categories: new Map([
				["food", { money: ars(200), missing: [] as const }],
				["gone", { money: null, missing: ["XQZ"] }],
			]),
		};
		expect(categoryReading(read, "food", "ARS")).toEqual(ars(200));
		expect(categoryReading(read, "nothing", "ARS")).toEqual(ars(0));
		expect(missing(categoryReading(read, "gone", "ARS"))).toEqual(["XQZ"]);
	});

	it("month: the one bar a loader read", () => {
		const bar = {
			month: "2026-10",
			span: { from: "2026-10-01", to: "2026-10-31" },
			total: ars(7),
		};
		expect(monthReading([bar], [])).toEqual(ars(7));
		expect(missing(monthReading([{ ...bar, total: null }], ["ARS"]))).toEqual([
			"ARS",
		]);
		// No bar at all (a loader with no months) is unavailable, not 0.
		expect(monthReading([], [])).toBeInstanceOf(FigureUnavailable);
	});

	it("cashflow: income, saved and the averages over this period's days and periods", () => {
		const ctx = ctxAt("2026-10-15T15:00:00Z");
		const period = insightsPeriod(ctx);
		const read = { spent: ars(5_760_010), income: ars(15_000_000), missing: [] };
		const at = (pick: keyof typeof cashflowPicks) =>
			cashflowReading(cashflowPicks[pick], read, ctx, period);
		expect(at("income")).toEqual(ars(15_000_000));
		// 15,000,000 - 5,760,010.
		expect(at("saved")).toEqual(ars(9_239_990));
		// 5,760,010 / 15 days elapsed = 384,000.67, half even: 384,001.
		expect(at("dailyAverage")).toEqual(ars(384_001));
		// One fiscal period.
		expect(at("monthlyAverage")).toEqual(ars(5_760_010));
	});

	it("cashflow without a reading names what kept it out", () => {
		const ctx = ctxAt("2026-10-15T15:00:00Z");
		const read = { spent: null, income: ars(1), missing: ["XQZ"] };
		const out = cashflowReading(
			cashflowPicks.saved,
			read,
			ctx,
			insightsPeriod(ctx),
		);
		expect(missing(out)).toEqual(["XQZ"]);
	});

	describe("ytd", () => {
		const side: YtdSide = {
			total: { home: ars(4_875_000), usd: usd(3_250) },
			categories: new Map([
				["food", { home: ars(4_875_000), usd: null }],
			]),
			missing: ["XQZ"],
		};
		const ctx = { home: "ARS" };

		it("the total, or one category, in home or USD", () => {
			expect(ytdReading(side, "home", ctx)).toEqual(ars(4_875_000));
			expect(ytdReading(side, "usd", ctx)).toEqual(usd(3_250));
			expect(ytdReading(side, "home", ctx, "food")).toEqual(ars(4_875_000));
		});

		it("a category with nothing reads 0 in the currency asked, never null", () => {
			expect(ytdReading(side, "home", ctx, "nothing")).toEqual(ars(0));
			expect(ytdReading(side, "usd", ctx, "nothing")).toEqual(usd(0));
		});

		it("a side that could not be valued names the currencies", () => {
			expect(missing(ytdReading(side, "usd", ctx, "food"))).toEqual(["XQZ"]);
		});
	});
});

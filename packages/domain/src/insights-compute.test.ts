/**
 * The shared Insights compute, with every expected value derived by hand. The
 * server runs it over SQL rows (src/server/services/insights); the same
 * rules on a real Postgres are pinned by characterization.pg.test.ts there.
 */
import { describe, expect, it } from "vitest";
import {
	insightsContextOf,
	instantRange,
	previousPeriod,
	spanRate,
	valueIn,
} from "./insights-compute";
import type { RateRow } from "./money";
import { dec } from "./precise-decimal";

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

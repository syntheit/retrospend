/**
 * The spending pace in exact decimals: every running total is one sumInDec
 * over the rows up to that day, rounded half to even once. Expected values are
 * derived by hand in each comment. Rates are stored units per USD (a share's
 * `exchangeRate` is the rate captured when it was saved); "now" is Oct 15 2026
 * noon in Buenos Aires, so this period is October (day 15 of 31) and the last
 * is September.
 */
import { describe, expect, it } from "vitest";
import type { DatedItem } from "./glance-pace";
import { runningHome, spanOf } from "./glance-pace";
import { MissingRateError, type MoneyItemDec, sumInDec } from "./money-dec";
import { roundedMinor } from "./money-minor";
import { dec } from "./precise-decimal";
import {
	lastToDate,
	type SpendPace,
	spendPaceFrom,
	spendPaceInputsFromRows,
} from "./spend-pace";
import { priceShare, type SpentExpenseRow, type SpentShareRow } from "./spent";

const BA = "America/Argentina/Buenos_Aires";
const NOON_BA = (d: string) => `${d}T15:00:00Z`;
const NOW = "2026-10-15T15:00:00Z";

const out = (
	day: string,
	amount: number,
	o: Partial<SpentExpenseRow> & { usd?: number } = {},
): SpentExpenseRow => ({
	status: "FINALIZED",
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	isAmortizedParent: false,
	excludeFromAnalytics: false,
	categoryKind: null,
	date: new Date(NOON_BA(day)),
	currency: "ARS",
	amount,
	amountInUSD: o.usd ?? amount / 1500,
	homeCurrency: null,
	homeAmount: null,
	...o,
});
const refund = (day: string, amount: number) =>
	out(day, amount, { direction: "IN", inType: "REFUND" });
const share = (
	day: string,
	amount: string,
	currency: string,
	exchangeRate: string | null,
): SpentShareRow => ({
	shareAmount: amount,
	verificationStatus: "PENDING",
	currency,
	date: new Date(NOON_BA(day)),
	projectId: null,
	exchangeRate,
	categoryId: null,
});
const rate = (iso: string, value: number, type = "blue") => ({
	date: new Date(iso),
	rate: value,
	type,
});

function pace(args: {
	home: string;
	rates?: ReturnType<typeof rate>[];
	expenses?: SpentExpenseRow[];
	shares?: SpentShareRow[];
	rateFor?: (s: SpentShareRow) => string | null;
}): SpendPace {
	const base = {
		home: args.home,
		startDay: 1,
		now: new Date(NOW),
		timeZone: BA,
	};
	return spendPaceFrom({
		...base,
		inputs: spendPaceInputsFromRows({
			...base,
			expenses: args.expenses ?? [],
			shares: args.shares ?? [],
			hiddenProjectIds: [],
			homeRates: args.rates ?? [],
			rateFor: args.rateFor,
		}),
	});
}

describe("ARS home on blue 1,545 from Oct 2, booked, unbooked and shared rows", () => {
	const rates = [
		rate("2026-09-15T00:00:00Z", 1500),
		rate("2026-10-02T00:00:00Z", 1545),
	];
	const expenses = [
		// Unbooked USD 10.01: 10 x 1,545 = 15,450 and 0.01 x 1,545 = 15.45, so 15,465.45.
		out("2026-10-02", 10.01, { currency: "USD", usd: 10.01 }),
		// Booked at save (ARS 1,200 a dollar): the booked 24,000 stays, not 30,900.
		out("2026-10-03", 20, {
			currency: "USD",
			usd: 20,
			homeCurrency: "ARS",
			homeAmount: 24_000,
		}),
		out("2026-10-04", 1000.5),
		refund("2026-10-06", 200),
		// Dated later this period: in the total, not in the series up to today.
		out("2026-10-20", 500),
		// Last period priced at its own end date, blue 1,500: 10.01 x 1,500 = 15,015.
		out("2026-09-10", 10.01, { currency: "USD", usd: 10.01 }),
	];
	const shares = [
		// EUR 12 at 0.9 EUR a dollar: 12 x 1,545 / 0.9 = 18,540 / 0.9 = 20,600.
		share("2026-10-05", "12", "EUR", "0.9"),
		// EUR 3 at 0.9, Sep: 3 x 1,500 / 0.9 = 4,500 / 0.9 = 5,000.
		share("2026-09-20", "3", "EUR", "0.9"),
	];

	it("each running total, in minor units", () => {
		const p = pace({ home: "ARS", rates, expenses, shares });
		// Oct 1: 0. Oct 2: 15,465.45. Oct 3: + 24,000 = 39,465.45.
		// Oct 4: + 1,000.50 = 40,465.95. Oct 5: + 20,600 = 61,065.95.
		// Oct 6: - 200 = 60,865.95, held to day 15.
		expect(p.thisSeries).toEqual([
			0, 1_546_545, 3_946_545, 4_046_595, 6_106_595, 6_086_595, 6_086_595,
			6_086_595, 6_086_595, 6_086_595, 6_086_595, 6_086_595, 6_086_595,
			6_086_595, 6_086_595,
		]);
		// The whole period adds Oct 20's 500: 61,365.95.
		expect(p.thisTotal).toBe(6_136_595);
		// September: Sep 10 15,015; Sep 20 + 5,000 = 20,015.
		expect(p.lastSeries?.[9]).toBe(1_501_500);
		expect(p.lastSeries?.[19]).toBe(2_001_500);
		expect(p.lastTotal).toBe(2_001_500);
		expect(lastToDate(p)).toBe(1_501_500);
	});

	it("the same rows in any order give the same figures", () => {
		const forwards = pace({ home: "ARS", rates, expenses, shares });
		const shuffled = pace({
			home: "ARS",
			rates,
			expenses: [...expenses].reverse(),
			shares: [...shares].reverse(),
		});
		expect(shuffled).toEqual(forwards);
	});
});

describe("a share's rate converts in one division, so a tie stays a tie", () => {
	it("EUR 1 at 7 into JPY at 17.5 is 2.5 yen, so 2 (half to even), and EUR 2 is 5", () => {
		// 1 x 17.5 / 7 = 2.5 exactly. Two of them: 5 exactly, not 2 + 2 or 3 + 3.
		const p = pace({
			home: "JPY",
			rates: [rate("2026-10-01T00:00:00Z", 17.5, "official")],
			shares: [
				share("2026-10-02", "1", "EUR", "7"),
				share("2026-10-03", "1", "EUR", "7"),
			],
		});
		expect(p.thisSeries?.slice(0, 4)).toEqual([0, 2, 5, 5]);
		expect(p.thisTotal).toBe(5);
	});

	it("ARS 1,545 blue: EUR 0.07 at 6 is 18.025 pesos, 18.02 (half to even), not 18.03", () => {
		// 0.07 x 1,545 / 6 = 108.15 / 6 = 18.025 exactly. The USD value cut to 15
		// digits first (0.0116666666666667) gave 18.025000000000051, which read as
		// 18.03 before. EUR 0.17: 262.65 / 6 = 43.775; together 61.80 exactly.
		const p = pace({
			home: "ARS",
			rates: [rate("2026-10-01T00:00:00Z", 1545)],
			shares: [
				share("2026-10-02", "0.07", "EUR", "6"),
				share("2026-10-03", "0.17", "EUR", "6"),
			],
		});
		expect(p.thisSeries?.slice(0, 4)).toEqual([0, 1_802, 6_180, 6_180]);
		expect(p.thisTotal).toBe(6_180);
	});

	it("shares on separate days add before they round: the last point is the period total", () => {
		// JPY home at 100 a dollar, EUR at 3 a dollar: a share of 0.005 EUR is
		// 0.005 x 100 / 3 = 0.1666... yen. Day 2: 0.17 yen, 0. Day 3: 0.01 x 100
		// / 3 = 0.33 yen, 0. Day 4: 0.015 x 100 / 3 = 0.5 yen exactly, a tie, so
		// 0 (even). Adding each day's own quotient (0.1666...67, cut at 40
		// digits) lands a hair above 0.5 and would read 1; so did the old float
		// path (0.00166666666666667 USD x 100, three times = 0.500000000000001).
		const shares = [
			share("2026-10-02", "0.005", "EUR", "3"),
			share("2026-10-03", "0.005", "EUR", "3"),
			share("2026-10-04", "0.005", "EUR", "3"),
		];
		const p = pace({
			home: "JPY",
			rates: [rate("2026-10-01T00:00:00Z", 100, "official")],
			shares,
		});
		expect(p.thisSeries?.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
		expect(p.thisTotal).toBe(0);
		const whole = sumInDec(
			shares.map((s): MoneyItemDec => {
				const priced = priceShare(String(s.shareAmount), "EUR", 3);
				return {
					amount: dec(s.shareAmount),
					currency: "EUR",
					amountInUSD: dec(priced.amountInUSD ?? 0),
					rate: dec(3),
				};
			}),
			"JPY",
			100,
		);
		expect(whole.toFixed()).toBe("0.5");
		expect(roundedMinor(whole, "JPY")).toBe(p.thisTotal);
	});
});

describe("refunds and zero", () => {
	it("a refund that rounds to nothing is 0, never -0, and a negative tie rounds half to even", () => {
		// Running, in pesos: Oct 2 -0.004 (0), Oct 3 -0.005 (a tie: 0), Oct 4
		// -0.015 (a tie at -1.5 cents: -2, the even one).
		const p = pace({
			home: "ARS",
			expenses: [
				refund("2026-10-02", 0.004),
				refund("2026-10-03", 0.001),
				refund("2026-10-04", 0.01),
			],
		});
		const series = p.thisSeries ?? [];
		expect(series.slice(0, 4)).toEqual([0, 0, 0, -2]);
		for (const n of series.slice(0, 3)) expect(Object.is(n, 0)).toBe(true);
	});

	it("an expense and its refund on one day net to 0", () => {
		const p = pace({
			home: "ARS",
			expenses: [out("2026-10-02", 5), refund("2026-10-02", 5)],
		});
		expect(Object.is(p.thisSeries?.[1], 0)).toBe(true);
		expect(Object.is(p.thisTotal, 0)).toBe(true);
	});
});

describe("a missing rate", () => {
	it("makes the pace unavailable and names every currency, never counting 1", () => {
		// No ARS rate: USD 5 needs it. Unpriced shares in XQZ and ISK have no rate.
		const p = pace({
			home: "ARS",
			expenses: [out("2026-10-02", 5, { currency: "USD", usd: 5 })],
			shares: [
				share("2026-10-03", "500", "XQZ", null),
				share("2026-10-04", "900", "ISK", null),
			],
			rateFor: () => null,
		});
		expect(p.thisSeries).toBeNull();
		expect(p.thisTotal).toBeNull();
		expect(p.missingRates).toEqual(["ARS", "ISK", "XQZ"]);
	});

	it("sumInDec throws one MissingRateError naming every currency", () => {
		const unpriced = (currency: string): MoneyItemDec => ({
			amount: dec(1),
			currency,
			amountInUSD: null,
		});
		let error: unknown;
		try {
			sumInDec([unpriced("XQZ"), unpriced("ISK")], "ARS", null);
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(MissingRateError);
		expect((error as MissingRateError).currencies).toEqual([
			"ARS",
			"ISK",
			"XQZ",
		]);
	});
});

describe("running totals cost", () => {
	it("5,000 rows over 31 days take well under a second", () => {
		const span = spanOf("2026-10-01", "2026-10-31");
		const rows: DatedItem[] = Array.from({ length: 5000 }, (_, i) => ({
			day: `2026-10-${String((i % 31) + 1).padStart(2, "0")}`,
			item:
				i % 3 === 0
					? {
							amount: dec("1.5"),
							currency: "EUR",
							amountInUSD: dec("1.6666667"),
							rate: dec("0.9"),
						}
					: { amount: dec(i), currency: "ARS", amountInUSD: dec("1") },
		}));
		const started = Date.now();
		const running = runningHome(rows, span, "ARS", 1545);
		expect(Date.now() - started).toBeLessThan(500);
		expect(running).toHaveLength(31);
	});
});

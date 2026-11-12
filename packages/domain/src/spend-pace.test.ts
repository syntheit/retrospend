/**
 * The glance's spending pace, computed from rows held in memory (the device
 * loader) with every expected value derived by hand. The pg conformance test
 * (src/server/services/figures/spend-pace.pg.test.ts) holds the SQL loader to
 * these same inputs.
 *
 * Zones: America/Argentina/Buenos_Aires (UTC-3, no DST) and America/Santiago
 * (UTC-4 in winter, UTC-3 in summer; summer time starts at 24:00 on Saturday
 * Sep 5 2026 and ends at 24:00 on Saturday Apr 4 2026).
 */
import { describe, expect, it } from "vitest";
import { RATE_ROWS_PER_SIDE, rateWindow } from "./money";
import { MissingRateError, sumInDec } from "./money-dec";
import { dec } from "./precise-decimal";
import {
	homeRateOn,
	lastToDate,
	type SpendPace,
	spendPaceFrom,
	spendPaceInputsFromRows,
	spendPacePeriods,
} from "./spend-pace";
import type { SpentExpenseRow, SpentShareRow } from "./spent";

const BA = "America/Argentina/Buenos_Aires";
const SCL = "America/Santiago";

type RowOptions = Partial<SpentExpenseRow> & { usd?: number };

const out = (
	iso: string,
	amount: number,
	{ usd, ...o }: RowOptions = {},
): SpentExpenseRow => ({
	status: "FINALIZED",
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	isAmortizedParent: false,
	excludeFromAnalytics: false,
	categoryKind: null,
	date: new Date(iso),
	currency: "ARS",
	amount,
	amountInUSD: usd ?? amount / 1500,
	homeCurrency: null,
	homeAmount: null,
	...o,
});
const refund = (iso: string, amount: number) =>
	out(iso, amount, { direction: "IN", inType: "REFUND" });
const income = (iso: string, amount: number, o: RowOptions = {}) =>
	out(iso, amount, { direction: "IN", inType: "INCOME", ...o });
const rate = (iso: string, value: number, type = "blue") => ({
	date: new Date(iso),
	rate: value,
	type,
});

/** Blue 1,400 from Sep 15 and 1,500 from Oct 5; official 1,000 must never win. */
const ARS_RATES = [
	rate("2026-09-15T00:00:00Z", 1400),
	rate("2026-10-05T00:00:00Z", 1500),
	rate("2026-10-05T00:00:00Z", 1000, "official"),
];

function pace(args: {
	expenses: SpentExpenseRow[];
	now: string;
	zone?: string;
	home?: string;
	rates?: ReturnType<typeof rate>[];
	startDay?: number;
	shares?: SpentShareRow[];
	rateFor?: (s: SpentShareRow) => number | null;
}): SpendPace {
	const base = {
		home: args.home ?? "ARS",
		startDay: args.startDay ?? 1,
		now: new Date(args.now),
		timeZone: args.zone ?? BA,
	};
	return spendPaceFrom({
		...base,
		inputs: spendPaceInputsFromRows({
			...base,
			expenses: args.expenses,
			shares: args.shares ?? [],
			hiddenProjectIds: [],
			homeRates: args.rates ?? ARS_RATES,
			rateFor: args.rateFor,
		}),
	});
}

const NOON_BA = (d: string) => `${d}T15:00:00Z`;

/** Every number a figure can carry is a whole, finite minor-unit count. */
function expectNoNaN(p: SpendPace) {
	for (const n of [
		...(p.thisSeries ?? []),
		...(p.lastSeries ?? []),
		p.thisTotal,
		p.lastTotal,
		p.moneyIn,
	])
		if (n !== null) expect(Number.isInteger(n)).toBe(true);
}

describe("spend pace, ARS home on the blue rate", () => {
	// Oct 15 2026, noon in Buenos Aires. This period Oct (31 days, day 15),
	// the last Sep (30 days).
	const expenses = [
		out(NOON_BA("2026-10-01"), 1000.5),
		out(NOON_BA("2026-10-03"), 10, { currency: "USD", usd: 10 }),
		refund(NOON_BA("2026-10-03"), 200),
		out(NOON_BA("2026-10-08"), 100, {
			currency: "USD",
			usd: 100,
			homeCurrency: "ARS",
			homeAmount: 140_000,
		}),
		out(NOON_BA("2026-10-20"), 5000),
		out(NOON_BA("2026-09-10"), 2000),
		out(NOON_BA("2026-09-20"), 4, { currency: "USD", usd: 4 }),
		// 22:00 on Sep 30 in Buenos Aires, already Oct 1 in UTC.
		out("2026-10-01T01:00:00Z", 300),
		refund(NOON_BA("2026-09-25"), 100),
		out(NOON_BA("2026-08-31"), 9999),
		// Never counted.
		out(NOON_BA("2026-10-05"), 900, { status: "DRAFT" }),
		out(NOON_BA("2026-10-05"), 900, { excludeFromAnalytics: true }),
		out(NOON_BA("2026-10-05"), 900, { entryKind: "NOT_SPENDING" }),
		// Money in: ARS 50,000 and USD 100 at blue 1,500 = ARS 200,000 in all.
		income(NOON_BA("2026-10-05"), 50_000),
		income(NOON_BA("2026-10-06"), 100, { currency: "USD", usd: 100 }),
		income(NOON_BA("2026-10-06"), 77, { excludeFromAnalytics: true }),
		income(NOON_BA("2026-09-06"), 66),
	];
	const now = "2026-10-15T15:00:00Z";

	it("this period by day: the booked value stays, USD takes the period rate (blue 1,500)", () => {
		const p = pace({ expenses, now });
		// Day 1 1,000.50; day 3 USD 10 = 15,000 less the 200 refund; day 8 the
		// booked 140,000 (not 150,000). Minor units, running.
		expect(p.period).toMatchObject({ from: "2026-10-01", days: 31, day: 15 });
		expect(p.thisSeries).toHaveLength(15);
		expect(p.thisSeries?.[0]).toBe(100_050);
		expect(p.thisSeries?.[1]).toBe(100_050);
		expect(p.thisSeries?.[2]).toBe(1_580_050);
		expect(p.thisSeries?.[7]).toBe(15_580_050);
		expect(p.thisSeries?.[14]).toBe(15_580_050);
		// The whole period counts the row dated Oct 20: + 5,000.
		expect(p.thisTotal).toBe(16_080_050);
		expectNoNaN(p);
	});

	it("last period priced on its own end date: blue 1,400, not today's 1,500", () => {
		const p = pace({ expenses, now });
		// 2,000 + USD 4 * 1,400 = 5,600 + 300 (Sep 30 in Buenos Aires) - 100.
		expect(p.last).toMatchObject({ from: "2026-09-01", days: 30 });
		expect(p.lastSeries).toHaveLength(30);
		expect(p.lastSeries?.[8]).toBe(0);
		expect(p.lastSeries?.[9]).toBe(200_000);
		expect(p.lastSeries?.[19]).toBe(760_000);
		expect(p.lastSeries?.[24]).toBe(750_000);
		expect(p.lastSeries?.[29]).toBe(780_000);
		expect(p.lastTotal).toBe(780_000);
		// By this period's day 15: only Sep 10's 2,000.
		expect(lastToDate(p)).toBe(200_000);
	});

	it("money in is income only, at the period's rate: ARS 200,000", () => {
		const p = pace({ expenses, now });
		expect(p.moneyIn).toBe(20_000_000);
		expect(p.missingRates).toEqual([]);
	});

	it("the same rows in UTC move the 22:00 row into October (month boundary)", () => {
		const p = pace({ expenses, now, zone: "UTC" });
		// Oct 1 01:00Z is day 1 of October in UTC: 1,000.50 + 300 on day 1.
		expect(p.thisSeries?.[0]).toBe(130_050);
		expect(p.thisTotal).toBe(16_110_050);
		expect(p.lastTotal).toBe(750_000);
	});

	it("without any rate: unavailable and named, never ARS 1 per dollar", () => {
		const p = pace({ expenses, now, rates: [] });
		expect(p.thisSeries).toBeNull();
		expect(p.lastSeries).toBeNull();
		expect(p.thisTotal).toBeNull();
		expect(p.lastTotal).toBeNull();
		expect(p.moneyIn).toBeNull();
		expect(p.missingRates).toEqual(["ARS"]);
		expect(lastToDate(p)).toBeNull();
	});

	it("rows already in the home currency total without a rate", () => {
		const p = pace({
			expenses: [
				out(NOON_BA("2026-10-02"), 40.4),
				out(NOON_BA("2026-09-02"), 10),
				income(NOON_BA("2026-10-02"), 90),
			],
			now,
			rates: [],
		});
		expect(p.thisTotal).toBe(4_040);
		expect(p.lastTotal).toBe(1_000);
		expect(p.moneyIn).toBe(9_000);
		expect(p.missingRates).toEqual([]);
	});

	it("a foreign row only this period leaves last period available", () => {
		const p = pace({
			expenses: [
				out(NOON_BA("2026-10-02"), 5, { currency: "USD", usd: 5 }),
				out(NOON_BA("2026-09-02"), 10),
			],
			now,
			rates: [],
		});
		expect(p.thisTotal).toBeNull();
		expect(p.lastTotal).toBe(1_000);
		expect(p.missingRates).toEqual(["ARS"]);
	});

	it("an unpriced share in a currency with no rate at all names it, in any home", () => {
		const share: SpentShareRow = {
			shareAmount: "500",
			verificationStatus: "PENDING",
			currency: "XQZ",
			date: new Date(NOON_BA("2026-10-02")),
			projectId: null,
			exchangeRate: null,
			categoryId: null,
		};
		const p = pace({
			expenses: [out(NOON_BA("2026-10-02"), 100)],
			now,
			shares: [share],
			rateFor: () => null,
		});
		expect(p.thisTotal).toBeNull();
		expect(p.thisSeries).toBeNull();
		expect(p.missingRates).toEqual(["XQZ"]);
		expect(p.lastTotal).toBe(0);
		expectNoNaN(p);
	});

	it("rows reach the same numbers whatever order a loader returns them in", () => {
		const forwards = pace({ expenses, now });
		const backwards = pace({ expenses: [...expenses].reverse(), now });
		expect(backwards).toEqual(forwards);
	});
});

describe("spend pace, home currencies with other decimals", () => {
	const now = "2026-10-15T15:00:00Z";

	it("JPY home (no decimals) at 150 per USD", () => {
		const p = pace({
			home: "JPY",
			rates: [rate("2026-10-01T00:00:00Z", 150, "official")],
			now,
			expenses: [
				// USD 10 = 1,500; JPY 1,234; KWD 12.345 worth USD 40 = 6,000.
				out(NOON_BA("2026-10-02"), 10, { currency: "USD", usd: 10 }),
				out(NOON_BA("2026-10-02"), 1234, { currency: "JPY", usd: 8.23 }),
				out(NOON_BA("2026-10-02"), 12.345, { currency: "KWD", usd: 40 }),
				income(NOON_BA("2026-10-03"), 3000, { currency: "JPY", usd: 20 }),
			],
		});
		expect(p.thisSeries?.[1]).toBe(8_734);
		expect(p.thisTotal).toBe(8_734);
		expect(p.moneyIn).toBe(3_000);
	});

	it("KWD home (3 decimals) at 0.3 per USD", () => {
		const p = pace({
			home: "KWD",
			rates: [rate("2026-10-01T00:00:00Z", 0.3, "official")],
			now,
			expenses: [
				// USD 100 = 30.000; JPY 1,500 worth USD 10 = 3.000; KWD 1.2345 stays 1.2345,
				// which the day rounds half to even to 1.234 only after adding the others.
				out(NOON_BA("2026-10-02"), 100, { currency: "USD", usd: 100 }),
				out(NOON_BA("2026-10-02"), 1500, { currency: "JPY", usd: 10 }),
				out(NOON_BA("2026-10-02"), 1.2345, { currency: "KWD", usd: 4 }),
			],
		});
		// 30 + 3 + 1.2345 = 34.2345, half to even at 3 decimals = 34.234 -> 34,234.
		expect(p.thisTotal).toBe(34_234);
	});
});

describe("spend pace edges", () => {
	const flat = (home = "ARS") => ({ home, rates: [] });

	it("first day of the period: one point, today is day 1", () => {
		// Oct 1 00:00 in Buenos Aires.
		const p = pace({
			...flat(),
			now: "2026-10-01T03:00:00Z",
			expenses: [
				out("2026-10-01T03:00:00Z", 12),
				out(NOON_BA("2026-09-30"), 7),
			],
		});
		expect(p.today).toBe("2026-10-01");
		expect(p.period.day).toBe(1);
		expect(p.thisSeries).toEqual([1_200]);
		expect(lastToDate(p)).toBe(0);
		expect(p.lastTotal).toBe(700);
	});

	it("one second earlier is still September's last day", () => {
		const p = pace({
			...flat(),
			now: "2026-10-01T02:59:59Z",
			expenses: [out("2026-10-01T02:59:00Z", 12)],
		});
		expect(p.today).toBe("2026-09-30");
		expect(p.period).toMatchObject({ from: "2026-09-01", days: 30, day: 30 });
		expect(p.last.days).toBe(31);
		expect(p.thisSeries).toHaveLength(30);
		expect(p.thisSeries?.at(-1)).toBe(1_200);
	});

	it("last day of the period: the series fills the whole month and ends on the total", () => {
		const p = pace({
			...flat(),
			now: "2026-11-01T02:59:00Z",
			expenses: [out(NOON_BA("2026-10-31"), 25), out(NOON_BA("2026-10-01"), 5)],
		});
		expect(p.period).toMatchObject({ days: 31, day: 31 });
		expect(p.thisSeries).toHaveLength(31);
		expect(p.thisSeries?.[0]).toBe(500);
		expect(p.thisSeries?.at(-1)).toBe(3_000);
		expect(p.thisTotal).toBe(3_000);
	});

	it("February 2027: 28 days against January's 31, compared on day 28", () => {
		const p = pace({
			...flat(),
			now: "2027-02-28T15:00:00Z",
			expenses: [
				out(NOON_BA("2027-01-28"), 10),
				out(NOON_BA("2027-01-31"), 5),
				out(NOON_BA("2027-02-28"), 40),
			],
		});
		expect(p.period).toMatchObject({ days: 28, day: 28 });
		expect(p.last.days).toBe(31);
		expect(p.thisTotal).toBe(4_000);
		expect(p.lastTotal).toBe(1_500);
		// Day 28 of January, not its last day.
		expect(lastToDate(p)).toBe(1_000);
	});

	it("March against a short February: past its last day the last period counts in full", () => {
		// March 30 2027, Feb 2027 has 28 days.
		const p = pace({
			...flat(),
			now: "2027-03-30T15:00:00Z",
			expenses: [out(NOON_BA("2027-02-10"), 10), out(NOON_BA("2027-02-28"), 5)],
		});
		expect(p.period.day).toBe(30);
		expect(p.last.days).toBe(28);
		expect(lastToDate(p)).toBe(1_500);
		// And in a leap year February has 29 days: day 29 is its last.
		const leap = pace({
			...flat(),
			now: "2028-03-29T15:00:00Z",
			expenses: [out(NOON_BA("2028-02-10"), 10), out(NOON_BA("2028-02-29"), 5)],
		});
		expect(leap.last.days).toBe(29);
		expect(lastToDate(leap)).toBe(1_500);
		const before = pace({
			...flat(),
			now: "2028-03-28T15:00:00Z",
			expenses: [out(NOON_BA("2028-02-10"), 10), out(NOON_BA("2028-02-29"), 5)],
		});
		expect(lastToDate(before)).toBe(1_000);
	});

	it("a fiscal month from the 15th: the period runs Feb 15 to Mar 14", () => {
		const p = pace({
			...flat(),
			startDay: 15,
			now: "2027-03-03T15:00:00Z",
			expenses: [
				out(NOON_BA("2027-02-15"), 10),
				out(NOON_BA("2027-03-14"), 20),
				out(NOON_BA("2027-03-15"), 99),
				out(NOON_BA("2027-01-15"), 7),
			],
		});
		expect(p.period).toMatchObject({
			from: "2027-02-15",
			to: "2027-03-14",
			days: 28,
			day: 17,
		});
		expect(p.last).toMatchObject({ from: "2027-01-15", days: 31 });
		expect(p.thisTotal).toBe(3_000);
		expect(p.thisSeries?.[0]).toBe(1_000);
		expect(p.lastTotal).toBe(700);
	});

	it("Santiago summer time starting: Sep 6 has no midnight, its days still split on the wall clock", () => {
		// 03:59:59Z is 23:59:59 on Sep 5 (UTC-4); 04:00:00Z is 01:00 on Sep 6 (UTC-3).
		const p = pace({
			...flat(),
			zone: SCL,
			now: "2026-09-06T15:00:00Z",
			expenses: [
				out("2026-09-06T03:59:59Z", 100),
				out("2026-09-06T04:00:00Z", 200),
				// Aug 31 in Santiago (UTC-4), already Sep 1 in UTC: last period.
				out("2026-09-01T03:30:00Z", 50),
			],
		});
		expect(p.today).toBe("2026-09-06");
		expect(p.period).toMatchObject({ from: "2026-09-01", days: 30, day: 6 });
		expect(p.thisSeries).toEqual([0, 0, 0, 0, 10_000, 30_000]);
		expect(p.lastTotal).toBe(5_000);
	});

	it("Santiago summer time ending: the repeated hour stays on Apr 4", () => {
		// 02:30Z and 03:30Z are both 23:30 on Apr 4 (UTC-3, then UTC-4).
		const p = pace({
			...flat(),
			zone: SCL,
			now: "2026-04-05T15:00:00Z",
			expenses: [
				out("2026-04-05T02:30:00Z", 100),
				out("2026-04-05T03:30:00Z", 200),
				out("2026-04-05T04:00:00Z", 400),
			],
		});
		expect(p.period).toMatchObject({ from: "2026-04-01", days: 30, day: 5 });
		expect(p.thisSeries).toEqual([0, 0, 0, 30_000, 70_000]);
	});

	it("the periods are the saved zone's: Buenos Aires and UTC disagree on the month", () => {
		const at = new Date("2026-11-01T01:30:00Z");
		expect(spendPacePeriods(at, 1, BA).period.from).toBe("2026-10-01");
		expect(spendPacePeriods(at, 1, "UTC").period.from).toBe("2026-11-01");
	});

	it("a missing rate is the totals rule's MissingRateError underneath", () => {
		expect(() =>
			sumInDec(
				[{ currency: "USD", amount: dec(1), amountInUSD: dec(1) }],
				"ARS",
				null,
			),
		).toThrow(MissingRateError);
	});
});

describe("the rate window the server reads", () => {
	const day = (n: number) => new Date(Date.UTC(2026, 8, n));
	const official = Array.from({ length: 25 }, (_, i) =>
		rate(day(1 + i).toISOString(), 30, "official"),
	);
	const stale = rate(day(1 - 12).toISOString(), 40);

	it("keeps the newest 20 rows on or before the date, newest first", () => {
		const w = rateWindow([stale, ...official], day(25));
		expect(w).toHaveLength(RATE_ROWS_PER_SIDE);
		expect(w[0]?.date).toEqual(day(25));
		expect(w.at(-1)?.date).toEqual(day(6));
		expect(w.some((r) => r.type === "blue")).toBe(false);
	});

	it("with few rows before the date the old blue row is still in the window", () => {
		expect(
			rateWindow([stale, ...official], day(10)).map((r) => r.type),
		).toContain("blue");
	});

	it("rows after the date count only when none exist on or before it", () => {
		const w = rateWindow(official, day(-5));
		expect(w).toHaveLength(RATE_ROWS_PER_SIDE);
		expect(w[0]?.date).toEqual(day(1));
		expect(rateWindow(official, day(1))).toHaveLength(1);
	});

	it("ties on one date are cut by type, as the server's ordering does", () => {
		const same = Array.from({ length: 22 }, (_, i) =>
			rate(day(1).toISOString(), i, `t${String(i).padStart(2, "0")}`),
		);
		const w = rateWindow(same, day(2));
		expect(w[0]?.type).toBe("t00");
		expect(w.at(-1)?.type).toBe("t19");
	});

	it("homeRateOn prices at official when the stale blue row is outside the window", () => {
		expect(homeRateOn("UYU", [stale, ...official], day(25))).toBe(30);
		expect(homeRateOn("UYU", [stale, ...official], day(10))).toBe(40);
		expect(homeRateOn("USD", [], day(10))).toBe(1);
		expect(homeRateOn("UYU", [], day(10))).toBeNull();
	});
});

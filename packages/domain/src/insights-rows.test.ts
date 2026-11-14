/**
 * The device loaders of Insights on rows in memory, all 14 insights.* figures
 * with every expected value derived by hand. Ledger A is the ledger of the
 * server's characterization test (src/server/services/insights/
 * characterization.pg.test.ts) with ARS in place of NGN, and expects the same
 * numbers; the other ledgers pin the start day, the half-even tie and the
 * year boundary. Each figure is read the way a registry reads it: the loader,
 * then the pick of insights-figures.
 *
 * ARS per USD: blue 1,400 from 2025-12-20; blue 1,500 and official 1,000 from
 * 2026-10-05 (blue outranks official; a span ending before Dec 20, 2025 takes
 * the nearest row after it). Buenos Aires is UTC-3 with no DST.
 */
import { describe, expect, it } from "vitest";
import type { FigureUnavailable } from "./figures/unavailable";
import type { Span } from "./insights";
import {
	type InsightsContext,
	insightsContextOf,
	previousPeriod,
} from "./insights-compute";
import {
	cashflowPicks,
	cashflowReading,
	categoryReading,
	insightsPeriod,
	insightsYtdSpans,
	monthReading,
	spanReading,
	ytdReading,
} from "./insights-figures";
import {
	cashflowFromRows,
	type InsightsRows,
	monthsFromRows,
	spanReadFromRows,
	ytdSideFromRows,
} from "./insights-rows";
import { type RateRow, rateLookup } from "./money";
import { type SpentExpenseRow, type SpentShareRow, shareRateOf } from "./spent";

const BA = "America/Argentina/Buenos_Aires";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ars = (minor: number) => ({ minor, currency: "ARS" });
const usd = (minor: number) => ({ minor, currency: "USD" });

const BLUE_1400: RateRow = {
	type: "blue",
	rate: 1400,
	date: day("2025-12-20"),
};
const ARS_RATES: RateRow[] = [
	BLUE_1400,
	{ type: "blue", rate: 1500, date: day("2026-10-05") },
	{ type: "official", rate: 1000, date: day("2026-10-05") },
];
const TRY_RATES: RateRow[] = [
	{ type: "official", rate: 40, date: day("2026-09-01") },
	{ type: "official", rate: 45, date: day("2026-10-01") },
];

function expense(
	at: string,
	o: Partial<SpentExpenseRow> = {},
): SpentExpenseRow {
	return {
		status: "FINALIZED",
		direction: "OUT",
		entryKind: "STANDARD",
		inType: null,
		isAmortizedParent: false,
		excludeFromAnalytics: false,
		categoryKind: o.categoryId ? "EXPENSE" : null,
		categoryId: null,
		date: new Date(at),
		currency: "ARS",
		amount: "0",
		amountInUSD: "0",
		homeCurrency: null,
		homeAmount: null,
		...o,
	};
}
const refund = (at: string, o: Partial<SpentExpenseRow>) =>
	expense(at, { direction: "IN", inType: "REFUND", ...o });
const income = (at: string, o: Partial<SpentExpenseRow>) =>
	expense(at, { direction: "IN", inType: "INCOME", ...o });
const shareOf = (
	at: string,
	o: Partial<SpentShareRow> & { shareAmount: string; currency: string },
): SpentShareRow => ({
	verificationStatus: "ACCEPTED",
	date: new Date(at),
	projectId: null,
	exchangeRate: null,
	categoryId: null,
	...o,
});

/** Rows plus the rate rows of every currency a share can be priced in. */
function loaded(
	rows: Pick<InsightsRows, "expenses"> & { shares?: SpentShareRow[] },
	shareRates: Record<string, readonly RateRow[]> = {},
): InsightsRows {
	return {
		expenses: rows.expenses,
		shares: rows.shares ?? [],
		hiddenProjectIds: [],
		shareRateFor: (s) =>
			shareRateOf(rateLookup(shareRates))({
				currency: s.currency,
				date: s.date,
				exchangeRate: s.exchangeRate,
			}),
	};
}

const context = (
	now: string,
	o: {
		home?: string;
		zone?: string;
		startDay?: number;
		rates?: RateRow[];
	} = {},
) =>
	insightsContextOf({
		home: o.home ?? "ARS",
		zone: o.zone ?? BA,
		startDay: o.startDay ?? 1,
		now: new Date(now),
		rateRows: o.rates ?? ARS_RATES,
	});

/** The 14 figures of the default view, each a loader and a pick as a registry makes them. */
function figures(rows: InsightsRows, ctx: InsightsContext) {
	const period = insightsPeriod(ctx);
	const span = (s: Span) => spanReadFromRows(rows, ctx, s);
	const cash = cashflowFromRows(rows, ctx, period);
	const spans = insightsYtdSpans(ctx);
	const side = {
		thisYear: ytdSideFromRows(rows, ctx, spans.thisYear),
		lastYear: ytdSideFromRows(rows, ctx, spans.lastYear),
	};
	const cashFigure = (pick: keyof typeof cashflowPicks) =>
		cashflowReading(cashflowPicks[pick], cash, ctx, period);
	return {
		spent: spanReading(span(period)),
		spentPrevious: spanReading(span(previousPeriod(ctx, period))),
		byCategory: (id: string) => categoryReading(span(period), id, ctx.home),
		byMonth: (label: string) => {
			const { bars, missing } = monthsFromRows(rows, ctx, [label]);
			return monthReading(bars, missing);
		},
		income: cashFigure("income"),
		saved: cashFigure("saved"),
		dailyAverage: cashFigure("dailyAverage"),
		monthlyAverage: cashFigure("monthlyAverage"),
		ytd: ytdReading(side.thisYear, "home", ctx),
		ytdLastYear: ytdReading(side.lastYear, "home", ctx),
		ytdByCategory: (id: string) => ytdReading(side.thisYear, "home", ctx, id),
		ytdUsd: ytdReading(side.thisYear, "usd", ctx),
		ytdLastYearUsd: ytdReading(side.lastYear, "usd", ctx),
		ytdByCategoryUsd: (id: string) => ytdReading(side.thisYear, "usd", ctx, id),
	};
}

const missing = (r: unknown) => (r as FigureUnavailable).missingRates;

describe("ledger A: rates by date, a booked row, an earlier home, a share priced on its own date", () => {
	const NOW = "2026-10-15T15:00:00Z";
	const at = (d: string) => `${d}T12:00:00-03:00`;
	const rows = loaded(
		{
			expenses: [
				expense(at("2026-10-03"), {
					amount: "30000",
					amountInUSD: "21.43",
					categoryId: "food",
				}),
				expense(at("2026-10-10"), {
					currency: "USD",
					amount: "10",
					amountInUSD: "10",
					categoryId: "food",
				}),
				expense(at("2026-10-11"), {
					currency: "USD",
					amount: "10",
					amountInUSD: "10",
					categoryId: "food",
					homeCurrency: "ARS",
					homeAmount: "14500",
				}),
				refund(at("2026-10-12"), {
					amount: "2000",
					amountInUSD: "1.43",
					categoryId: "food",
				}),
				expense("2026-11-01T02:30:00Z", {
					amount: "100.10",
					amountInUSD: "0.07",
				}),
				expense("2026-11-01T03:01:00Z", { amount: "7" }),
				expense("2026-10-01T02:59:00Z", { amount: "5" }),
				expense(at("2026-09-10"), {
					currency: "USD",
					amount: "20",
					amountInUSD: "20",
					categoryId: "transport",
					homeCurrency: "EUR",
					homeAmount: "18",
				}),
				income(at("2026-10-02"), {
					currency: "USD",
					amount: "100",
					amountInUSD: "100",
				}),
				income(at("2026-09-20"), {
					currency: "USD",
					amount: "50",
					amountInUSD: "50",
				}),
				expense("2026-01-01T03:10:00Z", {
					amount: "300",
					amountInUSD: "0.20",
					categoryId: "transport",
				}),
				expense("2026-01-01T02:50:00Z", { amount: "400", amountInUSD: "0.29" }),
				expense(at("2025-03-10"), {
					currency: "USD",
					amount: "10",
					amountInUSD: "10",
					categoryId: "food",
				}),
				expense("2025-01-01T03:20:00Z", {
					amount: "200",
					amountInUSD: "0.14",
					categoryId: "transport",
				}),
				expense("2025-01-01T02:50:00Z", { amount: "250", amountInUSD: "0.18" }),
			],
			shares: [
				shareOf(at("2026-09-10"), {
					shareAmount: "900",
					currency: "TRY",
					categoryId: "food",
				}),
			],
		},
		{ TRY: TRY_RATES },
	);
	const f = figures(rows, context(NOW));

	it("spent and spentPrevious: each period at its own end's blue, a booked row at its value", () => {
		// 30,000 + 10 x 1,500 + 14,500 - 2,000 + 100.10 = 57,600.10.
		expect(f.spent).toEqual(ars(5_760_010));
		// 5 + 20 x 1,400 (the EUR-booked row falls back to its USD value)
		// + 900 / 40 x 1,400 (the share at TRY 40, the rate on its own date).
		expect(f.spentPrevious).toEqual(ars(5_950_500));
	});

	it("byCategory: Food is 57,500.00 (a booked and an unbooked USD 10 make 29,500); absent reads 0", () => {
		expect(f.byCategory("food")).toEqual(ars(5_750_000));
		expect(f.byCategory("transport")).toEqual(ars(0));
		expect(f.byCategory("nothing")).toEqual(ars(0));
	});

	it("byMonth: each month at its own end's rate and instant edges", () => {
		expect(f.byMonth("2026-10")).toEqual(ars(5_760_010));
		expect(f.byMonth("2026-09")).toEqual(ars(5_950_500));
		// Dec 31 23:50 local is December; Jan 1 00:10 local is January;
		// Nov 1 00:01 local is November.
		expect(f.byMonth("2025-12")).toEqual(ars(40_000));
		expect(f.byMonth("2026-01")).toEqual(ars(30_000));
		expect(f.byMonth("2026-11")).toEqual(ars(700));
	});

	it("income, saved, dailyAverage, monthlyAverage", () => {
		expect(f.income).toEqual(ars(15_000_000)); // USD 100 x 1,500
		expect(f.saved).toEqual(ars(9_239_990)); // 150,000.00 - 57,600.10
		// 5,760,010 / 15 = 384,000.67 -> 384,001.
		expect(f.dailyAverage).toEqual(ars(384_001));
		expect(f.monthlyAverage).toEqual(ars(5_760_010));
	});

	it("ytd and its USD twins: the home side at 1,500, the USD side at frozen values", () => {
		// 300 + 30,000 + 15,000 + 14,500 - 2,000 + 5 + 20 x 1,500 + 22.50 x 1,500.
		expect(f.ytd).toEqual(ars(12_155_500));
		// Food 30,000 + 15,000 + 14,500 - 2,000 + 33,750; Transport 300 + 30,000.
		expect(f.ytdByCategory("food")).toEqual(ars(9_125_000));
		expect(f.ytdByCategory("transport")).toEqual(ars(3_030_000));
		expect(f.ytdByCategory("nothing")).toEqual(ars(0));
		// 0.20 + 21.43 + 10 + 10 - 1.43 + 0 + 20 + 22.50 = 82.70.
		expect(f.ytdUsd).toEqual(usd(8_270));
		expect(f.ytdByCategoryUsd("food")).toEqual(usd(6_250));
		expect(f.ytdByCategoryUsd("transport")).toEqual(usd(2_020));
		expect(f.ytdByCategoryUsd("nothing")).toEqual(usd(0));
	});

	it("ytdLastYear: a span ending before every blue row takes the nearest one after it", () => {
		// USD 10 x 1,400 + 200 = 14,200.00; Dec 31, 2024 23:50 local is out.
		expect(f.ytdLastYear).toEqual(ars(1_420_000));
		// 10 + 0.14.
		expect(f.ytdLastYearUsd).toEqual(usd(1_014));
	});

	it("a date-blind pick would be wrong here: one rate for September and October", () => {
		// At October's 1,500 September would be 5 + 30,000 + 33,750 = 63,755.
		expect(f.spentPrevious).not.toEqual(ars(6_375_500));
	});
});

describe("ledger B: the plan's lean ledger", () => {
	const at = (d: string) => `${d}T12:00:00-03:00`;
	const rows = loaded({
		expenses: [
			expense(at("2026-10-03"), {
				amount: "30000",
				amountInUSD: "21.43",
				categoryId: "food",
			}),
			expense(at("2026-10-10"), {
				currency: "USD",
				amount: "10",
				amountInUSD: "10",
				categoryId: "food",
			}),
			refund(at("2026-10-12"), {
				amount: "2000",
				amountInUSD: "1.43",
				categoryId: "food",
			}),
			expense("2026-11-01T02:30:00Z", { amount: "100" }),
			expense("2026-11-01T03:01:00Z", { amount: "7" }),
			expense("2026-10-01T02:59:00Z", { amount: "5" }),
			expense(at("2026-09-10"), {
				currency: "USD",
				amount: "20",
				amountInUSD: "20",
			}),
			income(at("2026-10-02"), {
				currency: "USD",
				amount: "100",
				amountInUSD: "100",
			}),
			expense(at("2025-03-10"), {
				currency: "USD",
				amount: "10",
				amountInUSD: "10",
				categoryId: "food",
			}),
		],
	});

	it("start day 1: October and September", () => {
		const f = figures(rows, context("2026-10-15T15:00:00Z"));
		expect(f.spent).toEqual(ars(4_310_000)); // 30,000 + 15,000 - 2,000 + 100
		expect(f.spentPrevious).toEqual(ars(2_800_500)); // 5 + 20 x 1,400
		expect(f.byCategory("food")).toEqual(ars(4_300_000));
		expect(f.byMonth("2026-10")).toEqual(ars(4_310_000));
		expect(f.byMonth("2026-09")).toEqual(ars(2_800_500));
		expect(f.income).toEqual(ars(15_000_000));
		expect(f.saved).toEqual(ars(10_690_000)); // 150,000.00 - 43,100.00
		// 4,310,000 / 15 = 287,333.33 -> 2,873.33.
		expect(f.dailyAverage).toEqual(ars(287_333));
		expect(f.monthlyAverage).toEqual(ars(4_310_000));
		// 30,000 + 15,000 - 2,000 + 5 + 20 x 1,500.
		expect(f.ytd).toEqual(ars(7_300_500));
		expect(f.ytdLastYear).toEqual(ars(1_400_000)); // USD 10 at blue 1,400
		expect(f.ytdByCategory("food")).toEqual(ars(4_300_000));
		expect(f.ytdUsd).toEqual(usd(5_000)); // 21.43 + 10 - 1.43 + 20
		expect(f.ytdLastYearUsd).toEqual(usd(1_000));
		expect(f.ytdByCategoryUsd("food")).toEqual(usd(3_000));
	});

	it("start day 15: the period is Oct 15 to Nov 14 and the one before Sep 15 to Oct 14", () => {
		const f = figures(rows, context("2026-10-15T15:00:00Z", { startDay: 15 }));
		// Nov 1 00:01 local belongs to this period: 100 + 7.
		expect(f.spent).toEqual(ars(10_700));
		// 30,000 + 10 x 1,500 (blue at Oct 14's end) - 2,000 + 5; Sep 10 is out.
		expect(f.spentPrevious).toEqual(ars(4_300_500));
		expect(f.byCategory("food")).toEqual(ars(0));
		expect(f.byMonth("2026-10")).toEqual(ars(10_700));
		// The income of Oct 2 is the period before.
		expect(f.income).toEqual(ars(0));
		expect(f.saved).toEqual(ars(-10_700));
		// One day has happened of this period, one period is touched.
		expect(f.dailyAverage).toEqual(ars(10_700));
		expect(f.monthlyAverage).toEqual(ars(10_700));
	});
});

describe("an exact half-even tie", () => {
	it("0.35 over 14 elapsed days is 0.025: 0.02, never 0.03", () => {
		const rows = loaded({
			expenses: [expense("2026-10-03T15:00:00Z", { amount: "0.35" })],
		});
		const f = figures(rows, context("2026-10-14T15:00:00Z", { rates: [] }));
		expect(f.spent).toEqual(ars(35));
		// 35 / 14 = 2.5 minor units: ties go to the even neighbor.
		expect(f.dailyAverage).toEqual(ars(2));
		expect(f.monthlyAverage).toEqual(ars(35));
	});
});

describe("the year boundary, clock 2027-01-01T03:30Z", () => {
	const NOW = "2027-01-01T03:30:00Z";
	const rows = loaded({
		expenses: [
			// Jan 1 00:10 in Buenos Aires, Dec 31 22:10 in New York.
			expense("2027-01-01T03:10:00Z", { amount: "300", amountInUSD: "0.20" }),
			// Dec 31 23:50 in Buenos Aires, 21:50 in New York.
			expense("2027-01-01T02:50:00Z", { amount: "400", amountInUSD: "0.29" }),
			// Jan 1, 2026 00:20 in Buenos Aires, Dec 31, 2025 22:20 in New York.
			expense("2026-01-01T03:20:00Z", {
				currency: "USD",
				amount: "10",
				amountInUSD: "10",
			}),
		],
	});

	it("Buenos Aires is already in the new year: only the 03:10Z row is this year's", () => {
		const f = figures(rows, context(NOW));
		expect(f.spent).toEqual(ars(30_000));
		expect(f.ytd).toEqual(ars(30_000));
		expect(f.ytdUsd).toEqual(usd(20));
		// Last year's span is Jan 1 only; USD 10 at blue 1,400 (the rate at its end).
		expect(f.ytdLastYear).toEqual(ars(1_400_000));
		expect(f.ytdLastYearUsd).toEqual(usd(1_000));
		// The 02:50Z row is December's, in neither year-to-date span.
		expect(f.byMonth("2026-12")).toEqual(ars(40_000));
	});

	it("New York is still on Dec 31: this year counts both rows, the 2026 row is last year's", () => {
		const f = figures(
			rows,
			context(NOW, { home: "USD", zone: "America/New_York", rates: [] }),
		);
		// Both ARS rows at their frozen USD values: 0.20 + 0.29.
		expect(f.ytd).toEqual(usd(49));
		expect(f.ytdUsd).toEqual(usd(49));
		expect(f.spent).toEqual(usd(49));
		// Last year is 2025 in full: the USD 10 row, no rate needed in USD home.
		expect(f.ytdLastYear).toEqual(usd(1_000));
		expect(f.ytdLastYearUsd).toEqual(usd(1_000));
	});
});

describe("a missing rate is named, never 1", () => {
	const at = (d: string) => `${d}T12:00:00-03:00`;

	it("a share in a currency with no rate leaves spent and ytdUsd out, naming it", () => {
		const rows = loaded({
			expenses: [],
			shares: [
				shareOf(at("2026-10-03"), { shareAmount: "10", currency: "XQZ" }),
			],
		});
		const f = figures(rows, context("2026-10-15T15:00:00Z"));
		expect(missing(f.spent)).toEqual(["XQZ"]);
		expect(missing(f.ytdUsd)).toEqual(["XQZ"]);
		expect(missing(f.ytd)).toEqual(["XQZ"]);
	});

	it("a home currency with no rate row cannot value a USD row", () => {
		const rows = loaded({
			expenses: [
				expense(at("2026-10-03"), {
					currency: "USD",
					amount: "10",
					amountInUSD: "10",
				}),
			],
		});
		const f = figures(
			rows,
			context("2026-10-15T15:00:00Z", { home: "QQQ", rates: [] }),
		);
		expect(missing(f.spent)).toEqual(["QQQ"]);
		// The USD twin needs no rate.
		expect(f.ytdUsd).toEqual(usd(1_000));
	});

	it("a share's captured rate prices it when the table has none", () => {
		const rows = loaded({
			expenses: [],
			shares: [
				shareOf(at("2026-10-03"), {
					shareAmount: "900",
					currency: "TRY",
					exchangeRate: "45",
				}),
			],
		});
		// 900 / 45 = USD 20 x 1,500 = 30,000.00.
		const f = figures(rows, context("2026-10-15T15:00:00Z"));
		expect(f.spent).toEqual(ars(3_000_000));
		expect(f.ytdUsd).toEqual(usd(2_000));
	});
});

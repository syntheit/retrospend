/**
 * Insights pricing, pinned with hand-derived values on a real Postgres, so a
 * move of the compute out of the server cannot change a digit unnoticed. The
 * other Insights pg files use one DKK rate row, which no pricing change could
 * move; this one has rate types, dates, booked rows and shares.
 *
 * Home is NGN (no other pg file prices NGN or TRY, so shared rate rows cannot
 * leak in), the zone is Buenos Aires (UTC-3, no DST), the fiscal month starts
 * on the 1st, and the clock is 2026-10-15T15:00Z (Oct 15, 12:00 local).
 *
 * NGN per USD: blue 1,400 on 2025-12-20; blue 1,500 and official 1,000 on
 * 2026-10-05. Blue outranks official, so a period ending before Oct 5 (or a
 * span ending before Dec 20, 2025, which takes the nearest row after it) reads
 * 1,400, and any date from Oct 5 on reads 1,500. TRY per USD: official 40 on
 * 2026-09-01, 45 on 2026-10-01.
 *
 * Rows (local days; "usd" is the frozen USD value):
 *   Oct 3   NGN 30,000 Food (usd 21.43)
 *   Oct 10  USD 10 Food, no booked value                       -> 10 x 1,500
 *   Oct 11  USD 10 Food, booked NGN 14,500 (rate 1,450)        -> 14,500
 *   Oct 12  refund NGN 2,000 Food (usd 1.43)
 *   Oct 31 23:30 (Nov 1 02:30Z) NGN 100.10, no category (usd 0.07)
 *   Nov 1 00:01 (03:01Z) NGN 7: November, not October
 *   Sep 30 23:59 (Oct 1 02:59Z) NGN 5, no category (usd 0.00)
 *   Sep 10  USD 20 Transport, booked in EUR 18 (an earlier home)
 *           -> falls back to its usd value, 20 x the rate
 *   Sep 10  share TRY 900 Food, no captured rate: priced on its own date at
 *           TRY 40 = USD 22.50
 *   Oct 2   income USD 100 (no booked value); Sep 20 income USD 50
 *   Jan 1 2026 00:10 (03:10Z) NGN 300 Transport (usd 0.20): this year
 *   Dec 31 2025 23:50 (Jan 1 02:50Z) NGN 400 (usd 0.29): last December,
 *           in neither span
 *   Mar 10 2025 USD 10 Food; Jan 1 2025 00:20 (03:20Z) NGN 200 Transport
 *   (usd 0.14): last year's span; Dec 31 2024 23:50 (02:50Z) NGN 250: out
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFigures } from "~/server/figures/read";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { category } from "./__tests__/fixture";
import {
	insightsCashflow,
	insightsMonths,
	insightsSummary,
	insightsYtd,
} from "./index";

const NOW = new Date("2026-10-15T15:00:00Z");
const ZONE = "America/Argentina/Buenos_Aires";
const ngn = (minor: number) => ({ minor, currency: "NGN" });
const usd = (minor: number) => ({ minor, currency: "USD" });

const dec = (value: string | number) => new Prisma.Decimal(value);

async function rate(
	currency: string,
	type: string,
	day: string,
	value: string,
) {
	const date = new Date(`${day}T00:00:00.000Z`);
	await adminDb.exchangeRate.upsert({
		where: { date_currency_type: { date, currency, type } },
		create: { date, currency, type, rate: value },
		update: { rate: value },
	});
}

async function user(home: string) {
	const { user: created } = await createTestUser();
	await adminDb.user.update({
		where: { id: created.id },
		data: { homeCurrency: home, fiscalMonthStartDay: 1, timeZone: ZONE },
	});
	return created.id;
}

interface Row {
	at: string;
	amount: string;
	currency?: string;
	usd: string;
	categoryId?: string;
	kind?: "spending" | "refund" | "income";
	/** The home leg booked when the row was saved. */
	booked?: { currency: string; amount: string };
}

function expense(userId: string, r: Row) {
	const kind = r.kind ?? "spending";
	return fixtureDb.expense.create({
		data: {
			userId,
			title: "Row",
			amount: dec(r.amount),
			currency: r.currency ?? "NGN",
			date: new Date(r.at),
			amountInUSD: dec(r.usd),
			exchangeRate: dec(1),
			pricingSource: "MANUAL",
			categoryId: r.categoryId ?? null,
			direction: kind === "spending" ? "OUT" : "IN",
			inType:
				kind === "spending" ? null : kind === "refund" ? "REFUND" : "INCOME",
			...(r.booked
				? {
						rateType: "official",
						homeCurrency: r.booked.currency,
						homeAmount: dec(r.booked.amount),
						homeRate: dec(r.booked.amount).div(dec(r.amount)),
					}
				: {}),
		},
	});
}

/** A shared expense the user paid, with only their own share, in a category of theirs. */
function share(
	userId: string,
	o: { at: string; amount: string; currency: string; categoryId?: string },
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount: o.amount,
			currency: o.currency,
			date: new Date(o.at),
			categoryId: o.categoryId ?? null,
			paidByType: "user",
			paidById: userId,
			createdByType: "user",
			createdById: userId,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: userId,
						shareAmount: o.amount,
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
	});
}

let ana: string;
let food: string;
let transport: string;
let lost: string;
let norates: string;

beforeAll(async () => {
	await rate("NGN", "blue", "2025-12-20", "1400");
	await rate("NGN", "blue", "2026-10-05", "1500");
	await rate("NGN", "official", "2026-10-05", "1000");
	await rate("TRY", "official", "2026-09-01", "40");
	await rate("TRY", "official", "2026-10-01", "45");

	ana = await user("NGN");
	food = await category(ana, "Food");
	transport = await category(ana, "Transport");
	const at = (day: string) => `${day}T12:00:00-03:00`;
	await expense(ana, {
		at: at("2026-10-03"),
		amount: "30000",
		usd: "21.43",
		categoryId: food,
	});
	await expense(ana, {
		at: at("2026-10-10"),
		amount: "10",
		currency: "USD",
		usd: "10",
		categoryId: food,
	});
	await expense(ana, {
		at: at("2026-10-11"),
		amount: "10",
		currency: "USD",
		usd: "10",
		categoryId: food,
		booked: { currency: "NGN", amount: "14500" },
	});
	await expense(ana, {
		at: at("2026-10-12"),
		amount: "2000",
		usd: "1.43",
		categoryId: food,
		kind: "refund",
	});
	await expense(ana, {
		at: "2026-11-01T02:30:00Z",
		amount: "100.10",
		usd: "0.07",
	});
	await expense(ana, { at: "2026-11-01T03:01:00Z", amount: "7", usd: "0.00" });
	await expense(ana, { at: "2026-10-01T02:59:00Z", amount: "5", usd: "0.00" });
	await expense(ana, {
		at: at("2026-09-10"),
		amount: "20",
		currency: "USD",
		usd: "20",
		categoryId: transport,
		booked: { currency: "EUR", amount: "18" },
	});
	await share(ana, {
		at: at("2026-09-10"),
		amount: "900",
		currency: "TRY",
		categoryId: food,
	});
	await expense(ana, {
		at: at("2026-10-02"),
		amount: "100",
		currency: "USD",
		usd: "100",
		kind: "income",
	});
	await expense(ana, {
		at: at("2026-09-20"),
		amount: "50",
		currency: "USD",
		usd: "50",
		kind: "income",
	});
	await expense(ana, {
		at: "2026-01-01T03:10:00Z",
		amount: "300",
		usd: "0.20",
		categoryId: transport,
	});
	await expense(ana, {
		at: "2026-01-01T02:50:00Z",
		amount: "400",
		usd: "0.29",
	});
	await expense(ana, {
		at: at("2025-03-10"),
		amount: "10",
		currency: "USD",
		usd: "10",
		categoryId: food,
	});
	await expense(ana, {
		at: "2025-01-01T03:20:00Z",
		amount: "200",
		usd: "0.14",
		categoryId: transport,
	});
	await expense(ana, {
		at: "2025-01-01T02:50:00Z",
		amount: "250",
		usd: "0.18",
	});

	// An XQZ share with no captured rate and no table row cannot be priced.
	lost = await user("NGN");
	await share(lost, { at: at("2026-10-03"), amount: "10", currency: "XQZ" });
	// A home currency with no rate row at all cannot value a USD row.
	norates = await user("QQQ");
	await expense(norates, {
		at: at("2026-10-03"),
		amount: "10",
		currency: "USD",
		usd: "10",
	});
});

describe("insights pricing, default view at 2026-10-15", () => {
	beforeAll(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterAll(() => {
		vi.useRealTimers();
	});

	const read = async (userId: string, id: string, narrowing = {}) =>
		(await readFigures(userId, [id], narrowing)).get(id);

	it("spent: October at blue 1,500, a booked row at its booked value", async () => {
		// 30,000 + 10 x 1,500 + 14,500 - 2,000 + 100.10 = 57,600.10; the row of
		// Nov 1 00:01 local is November's, not October's.
		expect(await read(ana, "insights.spent")).toEqual([ngn(5_760_010)]);
	});

	it("spentPrevious: September at its own end's blue 1,400, never the newer rate", async () => {
		// 5 + 20 x 1,400 (the EUR-booked row falls back to its USD value)
		// + 900 / 40 x 1,400 (the share at TRY 40, its own date's rate) = 59,505.
		expect(await read(ana, "insights.spentPrevious")).toEqual([ngn(5_950_500)]);
	});

	it("byCategory: Food 57,500.00 (a booked and an unbooked USD 10 are 29,500), absent categories read 0", async () => {
		expect(
			await read(ana, "insights.byCategory", { categoryId: food }),
		).toEqual([ngn(5_750_000)]);
		expect(
			await read(ana, "insights.byCategory", { categoryId: transport }),
		).toEqual([ngn(0)]);
		expect(
			await read(ana, "insights.byCategory", { categoryId: "nothing" }),
		).toEqual([ngn(0)]);
	});

	it("byMonth: each month at its own end's rate and edges", async () => {
		expect(await read(ana, "insights.byMonth")).toEqual([ngn(5_760_010)]);
		expect(await read(ana, "insights.byMonth", { month: "2026-10" })).toEqual([
			ngn(5_760_010),
		]);
		expect(await read(ana, "insights.byMonth", { month: "2026-09" })).toEqual([
			ngn(5_950_500),
		]);
		// Dec 31 23:50 local is December; Jan 1 00:10 local is January.
		expect(await read(ana, "insights.byMonth", { month: "2025-12" })).toEqual([
			ngn(40_000),
		]);
		expect(await read(ana, "insights.byMonth", { month: "2026-01" })).toEqual([
			ngn(30_000),
		]);
		expect(await read(ana, "insights.byMonth", { month: "2026-11" })).toEqual([
			ngn(700),
		]);
	});

	it("income, saved, dailyAverage, monthlyAverage", async () => {
		// Income USD 100 x 1,500 = 150,000.00.
		expect(await read(ana, "insights.income")).toEqual([ngn(15_000_000)]);
		// 150,000.00 - 57,600.10 = 92,399.90.
		expect(await read(ana, "insights.saved")).toEqual([ngn(9_239_990)]);
		// 5,760,010 minor over the 15 days elapsed = 384,000.67, half-even 384,001.
		expect(await read(ana, "insights.dailyAverage")).toEqual([ngn(384_001)]);
		// October is one fiscal period.
		expect(await read(ana, "insights.monthlyAverage")).toEqual([
			ngn(5_760_010),
		]);
	});

	it("ytd: Jan 1 to today at blue 1,500, the share at the same rate", async () => {
		// 300 + 30,000 + 15,000 + 14,500 - 2,000 + 5 + 20 x 1,500
		// + 22.50 x 1,500 = 121,555.00 (Oct 31 and Nov 1 are after today).
		expect(await read(ana, "insights.ytd")).toEqual([ngn(12_155_500)]);
		// Food: 30,000 + 15,000 + 14,500 - 2,000 + 33,750 = 91,250.
		expect(
			await read(ana, "insights.ytdByCategory", { categoryId: food }),
		).toEqual([ngn(9_125_000)]);
		// Transport: 300 + 30,000.
		expect(
			await read(ana, "insights.ytdByCategory", { categoryId: transport }),
		).toEqual([ngn(3_030_000)]);
		expect(
			await read(ana, "insights.ytdByCategory", { categoryId: "nothing" }),
		).toEqual([ngn(0)]);
	});

	it("ytdLastYear: a span that ends before every blue row takes the nearest one after it", async () => {
		// USD 10 x 1,400 (blue Dec 20, 2025) + 200 = 14,200.00; Dec 31, 2024
		// 23:50 local is out.
		expect(await read(ana, "insights.ytdLastYear")).toEqual([ngn(1_420_000)]);
	});

	it("the USD twins total the frozen USD values and never look a rate up", async () => {
		// 0.20 + 21.43 + 10 + 10 - 1.43 + 0.00 + 20 + 22.50 = 82.70.
		expect(await read(ana, "insights.ytdUsd")).toEqual([usd(8_270)]);
		// 10 + 0.14 = 10.14.
		expect(await read(ana, "insights.ytdLastYearUsd")).toEqual([usd(1_014)]);
		// Food 21.43 + 10 + 10 - 1.43 + 22.50 = 62.50; Transport 0.20 + 20.
		expect(
			await read(ana, "insights.ytdByCategoryUsd", { categoryId: food }),
		).toEqual([usd(6_250)]);
		expect(
			await read(ana, "insights.ytdByCategoryUsd", { categoryId: transport }),
		).toEqual([usd(2_020)]);
	});

	it("a share with no rate or a home with no rate is unavailable, never 1", async () => {
		expect(await read(lost, "insights.spent")).toBeNull();
		expect(await read(lost, "insights.ytdUsd")).toBeNull();
		expect(await read(norates, "insights.spent")).toBeNull();
	});
});

describe("insights reads at 2026-10-15", () => {
	const options = { now: NOW };
	const october = { from: "2026-10-01", to: "2026-10-31" };

	it("summary: the same totals with the change against September", async () => {
		const s = await insightsSummary(
			adminDb,
			ana,
			{ range: october, compare: true },
			options,
		);
		expect(s.previousRange).toEqual({ from: "2026-09-01", to: "2026-09-30" });
		expect(s.total.value).toEqual(ngn(5_760_010));
		expect(s.previousTotal?.value).toEqual(ngn(5_950_500));
		// (57,600.10 - 59,505.00) / 59,505.00 = -3.2%.
		expect(s.changePct).toBe(-3);
		// Spending entries: 30,000, both USD rows, the 100.10; the refund is not one.
		expect(s.count).toBe(4);
		expect(
			s.categories.map((c) => [c.categoryId, c.value, c.previous, c.changePct]),
		).toEqual([
			// Food 57,500.00 against the share's 31,500.00: +82.5%.
			[food, ngn(5_750_000), ngn(3_150_000), 83],
			// 100.10 against 5.00: +1,902%.
			[null, ngn(10_010), ngn(500), 1902],
		]);
		expect(s.missingRates).toEqual([]);
	});

	it("summary of September reads its own end's rate", async () => {
		const s = await insightsSummary(
			adminDb,
			ana,
			{ range: { from: "2026-09-01", to: "2026-09-30" }, compare: false },
			options,
		);
		expect(s.total.value).toEqual(ngn(5_950_500));
	});

	it("cashflow: income at the range's rate, averages over the days that happened", async () => {
		const c = await insightsCashflow(adminDb, ana, { range: october }, options);
		expect(c.income.value).toEqual(ngn(15_000_000));
		expect(c.saved.value).toEqual(ngn(9_239_990));
		// 9,239,990 x 100 / 15,000,000 = 61.6 -> 62.
		expect(c.savingsRatePct).toBe(62);
		expect(c.dailyAverage.value).toEqual(ngn(384_001));
		expect(c.monthlyAverage.value).toEqual(ngn(5_760_010));

		const sep = await insightsCashflow(
			adminDb,
			ana,
			{ range: { from: "2026-09-01", to: "2026-09-30" } },
			options,
		);
		// Income USD 50 x 1,400 = 70,000.00; saved 70,000.00 - 59,505.00.
		expect(sep.income.value).toEqual(ngn(7_000_000));
		expect(sep.saved.value).toEqual(ngn(1_049_500));
		// 1,049,500 x 100 / 7,000,000 = 14.99 -> 15.
		expect(sep.savingsRatePct).toBe(15);
		// All 30 days happened: 5,950,500 / 30 = 198,350.
		expect(sep.dailyAverage.value).toEqual(ngn(198_350));
	});

	it("year to date: both currencies, ranked, with the change against last year", async () => {
		const y = await insightsYtd(adminDb, ana, {}, options);
		expect(y.thisYear).toEqual({ from: "2026-01-01", to: "2026-10-15" });
		expect(y.lastYear).toEqual({ from: "2025-01-01", to: "2025-10-15" });
		expect(y.total.home.value).toEqual(ngn(12_155_500));
		expect(y.total.usd.value).toEqual(usd(8_270));
		expect(y.lastYearTotal.home.value).toEqual(ngn(1_420_000));
		expect(y.lastYearTotal.usd.value).toEqual(usd(1_014));
		// (121,555 - 14,200) / 14,200 = 756%; (82.70 - 10.14) / 10.14 = 716%.
		expect(y.total.changePct).toBe(756);
		expect(y.total.usdChangePct).toBe(716);
		expect(
			y.categories.map((c) => [
				c.categoryId,
				c.value.home,
				c.value.usd,
				c.usdRank,
			]),
		).toEqual([
			[food, ngn(9_125_000), usd(6_250), 0],
			[transport, ngn(3_030_000), usd(2_020), 1],
			[null, ngn(500), usd(0), 2],
		]);
		expect(y.missingRates).toEqual([]);
	});

	it("months: the window's bars at each month's own rate", async () => {
		const m = await insightsMonths(
			adminDb,
			ana,
			{ to: "2026-10-31", count: 4 },
			options,
		);
		expect(m.months.map((b) => [b.month, b.total])).toEqual([
			["2026-07", ngn(0)],
			["2026-08", ngn(0)],
			["2026-09", ngn(5_950_500)],
			["2026-10", ngn(5_760_010)],
		]);
		expect(m.months[2]?.span).toEqual({ from: "2026-09-01", to: "2026-09-30" });
		const boundary = await insightsMonths(
			adminDb,
			ana,
			{ to: "2026-01-31", count: 2 },
			options,
		);
		expect(boundary.months.map((b) => [b.month, b.total])).toEqual([
			["2025-12", ngn(40_000)],
			["2026-01", ngn(30_000)],
		]);
	});

	it("names the currency that kept a figure out", async () => {
		const s = await insightsSummary(
			adminDb,
			lost,
			{ range: october, compare: false },
			options,
		);
		expect(s.total.value).toBeNull();
		expect(s.missingRates).toEqual(["XQZ"]);
		const y = await insightsYtd(adminDb, lost, {}, options);
		expect(y.total.home.value).toBeNull();
		expect(y.total.usd.value).toBeNull();
		expect(y.missingRates).toEqual(["XQZ"]);

		const bare = await insightsSummary(
			adminDb,
			norates,
			{ range: october, compare: false },
			options,
		);
		expect(bare.total.value).toBeNull();
		expect(bare.missingRates).toEqual(["QQQ"]);
	});
});

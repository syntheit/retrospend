/**
 * Insights on a real Postgres (RLS on), every number worked out by hand.
 * Home is DKK and DKK is USD 1 = 7.00 from 2026-10-01 (the only rate row,
 * so every date reads it). "Now" is 2026-10-24 12:00 in Buenos Aires.
 *
 * Ana (Buenos Aires, UTC-3), October:
 *   Oct 1 00:30 local (03:30Z)  DKK 70, no category
 *   Oct 3  Groceries DKK 100;  Oct 5  Groceries USD 10 = DKK 70
 *   Oct 10 Transport USD 21;   Oct 11 Transport refund USD 1 -> USD 20 = DKK 140
 *   Groceries 170, Transport 140, none 70: DKK 380.00. Four expenses.
 * September:
 *   Sep 1 Groceries DKK 100; Sep 30 23:30 local (Oct 1 02:30Z) Groceries
 *   DKK 30 (it is September for her, October in UTC); Sep 15 Transport DKK 35
 *   -> Groceries 130, Transport 35: DKK 165.00.
 * Change: 380 against 165 is +130.3%, so 130. Groceries 170 / 130 is +30.77%,
 * so 31. Transport 140 / 35 is +300%. No uncategorized spending in September.
 * Income: DKK 1,000 and USD 100 (DKK 700): 1,700.00.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	insightsRangeSchema,
	insightsSummaryInputSchema,
} from "~/lib/schemas/insights";
import { insightsRouter } from "~/server/api/routers/insights";
import { createCallerFactory } from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import { adminDb } from "~/test/pg-harness";
import {
	category,
	dkk,
	insightsUser,
	row,
	seedDkkRates,
	sharedExpense,
	usd,
} from "./__tests__/fixture";
import {
	insightsCashflow,
	insightsMonths,
	insightsSummary,
	insightsYtd,
} from "./index";
import { summaryIn } from "./summary";

const NOW = new Date("2026-10-24T15:00:00Z");
const ZONE = "America/Argentina/Buenos_Aires";
const at = { now: NOW } as const;
const OCT = { from: "2026-10-01", to: "2026-10-31" };

let ana: string;
let groceries: string;
let transport: string;

async function seedAna(userId: string, cats: { g: string; t: string }) {
	await row(userId, {
		at: "2026-10-01T00:30:00-03:00",
		amount: "70",
		usd: "10",
	});
	await row(userId, {
		at: "2026-10-03T12:00:00-03:00",
		amount: "100",
		usd: "15",
		categoryId: cats.g,
	});
	await row(userId, {
		at: "2026-10-05T12:00:00-03:00",
		amount: "10",
		currency: "USD",
		usd: "10",
		categoryId: cats.g,
	});
	await row(userId, {
		at: "2026-10-10T12:00:00-03:00",
		amount: "21",
		currency: "USD",
		usd: "21",
		categoryId: cats.t,
	});
	await row(userId, {
		at: "2026-10-11T12:00:00-03:00",
		amount: "1",
		currency: "USD",
		usd: "1",
		categoryId: cats.t,
		kind: "refund",
	});
	await row(userId, {
		at: "2026-09-01T12:00:00-03:00",
		amount: "100",
		usd: "15",
		categoryId: cats.g,
	});
	await row(userId, {
		at: "2026-09-30T23:30:00-03:00",
		amount: "30",
		usd: "4.5",
		categoryId: cats.g,
	});
	await row(userId, {
		at: "2026-09-15T12:00:00-03:00",
		amount: "35",
		usd: "5",
		categoryId: cats.t,
	});
	await row(userId, {
		at: "2026-10-02T12:00:00-03:00",
		amount: "1000",
		usd: "143",
		kind: "income",
	});
	await row(userId, {
		at: "2026-10-03T13:00:00-03:00",
		amount: "100",
		currency: "USD",
		usd: "100",
		kind: "income",
	});
}

beforeAll(async () => {
	await seedDkkRates();
	ana = await insightsUser();
	groceries = await category(ana, "Groceries");
	transport = await category(ana, "Transport");
	await seedAna(ana, { g: groceries, t: transport });
});

describe("insights summary", () => {
	it("October by category in DKK: two currencies, a refund netted, ranked", async () => {
		const s = await insightsSummary(
			adminDb,
			ana,
			{ range: OCT, compare: false },
			at,
		);
		expect(s.home).toBe("DKK");
		expect(s.total).toEqual({ id: "insights.spent", value: dkk(38_000) });
		expect(s.count).toBe(4);
		expect(s.categories.map((c) => [c.categoryId, c.value])).toEqual([
			[groceries, dkk(17_000)],
			[transport, dkk(14_000)],
			[null, dkk(7_000)],
		]);
		expect(s.previousRange).toBeNull();
		expect(s.previousTotal).toBeNull();
		expect(s.missingRates).toEqual([]);
	});

	it("compare: the whole month before in her zone, September 30 23:30 stays September", async () => {
		const s = await insightsSummary(
			adminDb,
			ana,
			{ range: OCT, compare: true },
			at,
		);
		expect(s.previousRange).toEqual({ from: "2026-09-01", to: "2026-09-30" });
		expect(s.previousTotal).toEqual({
			id: "insights.spentPrevious",
			value: dkk(16_500),
		});
		expect(s.changePct).toBe(130);
		expect(
			s.categories.map((c) => [c.categoryId, c.previous, c.changePct]),
		).toEqual([
			[groceries, dkk(13_000), 31],
			[transport, dkk(3_500), 300],
			// Nothing uncategorized in September: it reads "new".
			[null, null, null],
		]);
	});

	it("compare across a month boundary that is not a whole month keeps the length", async () => {
		// Sep 28 to Oct 4 (7 days) against Sep 21 to Sep 27.
		const s = await insightsSummary(
			adminDb,
			ana,
			{ range: { from: "2026-09-28", to: "2026-10-04" }, compare: true },
			at,
		);
		expect(s.previousRange).toEqual({ from: "2026-09-21", to: "2026-09-27" });
		// Sep 30 DKK 30; Oct 1 DKK 70, Oct 3 DKK 100: 200.
		expect(s.total.value).toEqual(dkk(20_000));
		expect(s.previousTotal?.value).toEqual(dkk(0));
		expect(s.changePct).toBeNull();
	});

	it("filters narrow the same rows: Groceries only", async () => {
		const s = await insightsSummary(
			adminDb,
			ana,
			{ range: OCT, compare: false, filter: { categoryIds: [groceries] } },
			at,
		);
		expect(s.total.value).toEqual(dkk(17_000));
		expect(s.count).toBe(2);
		expect(s.categories.map((c) => c.categoryId)).toEqual([groceries]);
	});

	it("a share in a currency with no rate: the total and its category are unavailable and named, the rest stand", async () => {
		const bea = await insightsUser();
		const g = await category(bea, "Groceries");
		const t = await category(bea, "Transport");
		await seedAna(bea, { g, t });
		const payer = await insightsUser();
		await sharedExpense({
			payer,
			userId: bea,
			share: "40",
			currency: "XTK",
			at: "2026-10-15T12:00:00-03:00",
		});
		const s = await insightsSummary(
			adminDb,
			bea,
			{ range: OCT, compare: false },
			at,
		);
		expect(s.total.value).toBeNull();
		expect(s.missingRates).toEqual(["XTK"]);
		// The share has no category, so it joins the DKK 70 row: both out.
		expect(s.categories.map((c) => [c.categoryId, c.value])).toEqual([
			[g, dkk(17_000)],
			[t, dkk(14_000)],
			[null, null],
		]);
		expect(s.count).toBe(5);
	});

	it("person and project filters read shares only", async () => {
		const cleo = await insightsUser();
		const payer = await insightsUser();
		const g = await category(cleo, "Groceries");
		const project = await adminDb.project.create({
			data: { name: "Trip", createdById: payer, primaryCurrency: "DKK" },
		});
		const paz = await adminDb.shadowProfile.create({
			data: { createdById: payer, name: "Paz" },
		});
		// As a project member she sees who else is in the project's expenses.
		await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "user",
				participantId: cleo,
				role: "VIEWER",
			},
		});
		await row(cleo, {
			at: "2026-10-03T12:00:00-03:00",
			amount: "100",
			usd: "14",
			categoryId: g,
		});
		await sharedExpense({
			payer,
			userId: cleo,
			share: "40",
			at: "2026-10-20T12:00:00-03:00",
			projectId: project.id,
			withShadow: paz.id,
		});
		await sharedExpense({
			payer,
			userId: cleo,
			share: "25",
			at: "2026-10-21T12:00:00-03:00",
		});
		const read = (filter: object) =>
			insightsSummary(
				adminDb,
				cleo,
				{ range: OCT, compare: false, filter },
				at,
			);
		expect((await read({})).total.value).toEqual(dkk(16_500));
		const inProject = await read({ projectIds: [project.id] });
		expect(inProject.total.value).toEqual(dkk(4_000));
		expect(inProject.count).toBe(1);
		expect(
			(await read({ personKeys: [`shadow:${paz.id}`] })).total.value,
		).toEqual(dkk(4_000));
		expect((await read({ categoryIds: [g] })).total.value).toEqual(dkk(10_000));
	});

	it("RLS: another user reading Ana's id sees no rows", async () => {
		const other = await insightsUser();
		const s = await userTransaction(adminDb, other, (tx) =>
			summaryIn(tx, ana, { range: OCT, compare: false }, at),
		);
		expect(s.count).toBe(0);
		expect(s.total.value?.minor).toBe(0);
	});
});

describe("insights months", () => {
	it("the last three months end at the month of the range", async () => {
		const m = await insightsMonths(
			adminDb,
			ana,
			{ to: "2026-10-31", count: 3 },
			at,
		);
		expect(m.months.map((b) => [b.month, b.span, b.total])).toEqual([
			["2026-08", { from: "2026-08-01", to: "2026-08-31" }, dkk(0)],
			["2026-09", { from: "2026-09-01", to: "2026-09-30" }, dkk(16_500)],
			["2026-10", { from: "2026-10-01", to: "2026-10-31" }, dkk(38_000)],
		]);
	});

	it("a range in the future ends at this month, and months follow the fiscal start day", async () => {
		const m = await insightsMonths(
			adminDb,
			ana,
			{ to: "2027-03-31", count: 2 },
			at,
		);
		expect(m.months.map((b) => b.month)).toEqual(["2026-09", "2026-10"]);
		// Fiscal months starting on the 15th: Sep 15 to Oct 14 holds the Sep 30
		// DKK 30 and the Oct 14 DKK 70; Oct 15 to Nov 14 holds the Oct 15 DKK 55.
		const mid = await insightsUser({ startDay: 15 });
		await row(mid, { at: "2026-09-30T23:30:00-03:00", amount: "30", usd: "4" });
		await row(mid, {
			at: "2026-10-14T12:00:00-03:00",
			amount: "70",
			usd: "10",
		});
		await row(mid, { at: "2026-10-15T12:00:00-03:00", amount: "55", usd: "8" });
		const fiscal = await insightsMonths(
			adminDb,
			mid,
			{ to: "2026-10-20", count: 1 },
			at,
		);
		expect(fiscal.months).toEqual([
			{
				month: "2026-10",
				span: { from: "2026-10-15", to: "2026-11-14" },
				figure: "insights.byMonth",
				total: dkk(5_500),
			},
		]);
		const before = await insightsMonths(
			adminDb,
			mid,
			{ to: "2026-10-14", count: 1 },
			at,
		);
		expect(before.months[0]).toMatchObject({
			month: "2026-09",
			span: { from: "2026-09-15", to: "2026-10-14" },
			total: dkk(10_000),
		});
	});
});

describe("insights year to date", () => {
	it("January 1 to today in her zone, against the same span last year, in DKK and USD", async () => {
		// Nina lives in Auckland (UTC+13): the year starts 13 hours before it does in UTC.
		const nina = await insightsUser({ zone: "Pacific/Auckland", startDay: 15 });
		const g = await category(nina, "Groceries");
		const t = await category(nina, "Transport");
		const r = (
			when: string,
			amount: string,
			usdValue: string,
			categoryId: string,
			currency = "DKK",
		) => row(nina, { at: when, amount, usd: usdValue, categoryId, currency });
		await r("2026-01-01T00:30:00+13:00", "100", "15", g); // Dec 31 11:30Z: this year
		await r("2026-10-25T08:00:00+13:00", "50", "7", g); // today, later in the day
		await r("2026-03-03T12:00:00+13:00", "20", "20", t, "USD");
		await r("2025-10-25T23:30:00+13:00", "80", "12", g); // last year's last day
		await r("2025-10-26T00:30:00+13:00", "999", "1", g); // a day past it: out
		await r("2025-01-01T00:30:00+13:00", "60", "9", t); // Dec 31 2024 11:30Z: last year
		await r("2025-06-10T12:00:00+13:00", "10", "10", t, "USD");
		await r("2025-12-31T23:30:00+13:00", "11", "2", g); // between the spans: out
		await r("2024-12-31T23:30:00+13:00", "5", "1", g); // before last year: out
		const y = await insightsYtd(adminDb, nina, {}, at);
		expect(y.thisYear).toEqual({ from: "2026-01-01", to: "2026-10-25" });
		expect(y.lastYear).toEqual({ from: "2025-01-01", to: "2025-10-25" });
		// This year: Groceries 150, Transport USD 20 = 140: 290.
		expect(y.total.home).toEqual({ id: "insights.ytd", value: dkk(29_000) });
		expect(y.total.usd).toEqual({ id: "insights.ytdUsd", value: usd(4_200) });
		// Last year: Groceries 80, Transport 60 + USD 10 = 70: 210.
		expect(y.lastYearTotal.home).toEqual({
			id: "insights.ytdLastYear",
			value: dkk(21_000),
		});
		expect(y.lastYearTotal.usd).toEqual({
			id: "insights.ytdLastYearUsd",
			value: usd(3_100),
		});
		// 8,000 to 29,000 is +38.1%; USD 31 to 42 is +35.5%.
		expect(y.total.changePct).toBe(38);
		expect(y.total.usdChangePct).toBe(35);
		expect(
			y.categories.map((c) => [
				c.categoryId,
				c.value,
				c.lastYear,
				c.changePct,
				c.usdChangePct,
			]),
		).toEqual([
			[
				g,
				{ home: dkk(15_000), usd: usd(2_200) },
				{ home: dkk(8_000), usd: usd(1_200) },
				88,
				83,
			],
			[
				t,
				{ home: dkk(14_000), usd: usd(2_000) },
				{ home: dkk(13_000), usd: usd(1_900) },
				8,
				5,
			],
		]);
		expect(y.missingRates).toEqual([]);
	});

	it("February 29 compares with February 28 of the year before", async () => {
		const leap = await insightsUser();
		await row(leap, {
			at: "2027-02-28T12:00:00-03:00",
			amount: "10",
			usd: "1",
		});
		await row(leap, {
			at: "2028-02-29T12:00:00-03:00",
			amount: "30",
			usd: "4",
		});
		const y = await insightsYtd(
			adminDb,
			leap,
			{},
			{ now: new Date("2028-02-29T15:00:00Z") },
		);
		expect(y.lastYear).toEqual({ from: "2027-01-01", to: "2027-02-28" });
		expect(y.total.home.value).toEqual(dkk(3_000));
		expect(y.lastYearTotal.home.value).toEqual(dkk(1_000));
		expect(y.total.changePct).toBe(200);
	});

	it("a share in a currency with no rate leaves the DKK and USD views unavailable, named", async () => {
		const lost = await insightsUser();
		await row(lost, {
			at: "2026-05-05T12:00:00-03:00",
			amount: "10",
			usd: "0.5",
		});
		const payer = await insightsUser();
		await sharedExpense({
			payer,
			userId: lost,
			share: "9",
			currency: "XTK",
			at: "2026-05-06T12:00:00-03:00",
		});
		const y = await insightsYtd(adminDb, lost, {}, at);
		expect(y.total.usd.value).toBeNull();
		expect(y.total.home.value).toBeNull();
		expect(y.missingRates).toEqual(["XTK"]);
	});
});

describe("insights cashflow", () => {
	it("income, what was left, the savings rate and the averages", async () => {
		const c = await insightsCashflow(adminDb, ana, { range: OCT }, at);
		expect(c.income).toEqual({ id: "insights.income", value: dkk(170_000) });
		// 1,700.00 in, 380.00 out.
		expect(c.saved).toEqual({ id: "insights.saved", value: dkk(132_000) });
		expect(c.savingsRatePct).toBe(78); // 77.65
		// 24 days have happened (Oct 1 to Oct 24): 38,000 / 24 = 1,583.33.
		expect(c.dailyAverage).toEqual({
			id: "insights.dailyAverage",
			value: dkk(1_583),
		});
		expect(c.monthlyAverage).toEqual({
			id: "insights.monthlyAverage",
			value: dkk(38_000),
		});
	});

	it("a range that touches two months splits the spending over both", async () => {
		const c = await insightsCashflow(
			adminDb,
			ana,
			{ range: { from: "2026-10-01", to: "2026-11-15" } },
			at,
		);
		expect(c.monthlyAverage.value).toEqual(dkk(19_000));
		// Still 24 days elapsed: the future days do not dilute it.
		expect(c.dailyAverage.value).toEqual(dkk(1_583));
	});

	it("no income means no savings rate, not zero", async () => {
		const poor = await insightsUser();
		await row(poor, {
			at: "2026-10-03T12:00:00-03:00",
			amount: "100",
			usd: "14",
		});
		const c = await insightsCashflow(adminDb, poor, { range: OCT }, at);
		expect(c.income.value).toEqual(dkk(0));
		expect(c.saved.value).toEqual(dkk(-10_000));
		expect(c.savingsRatePct).toBeNull();
	});
});

describe("insights router", () => {
	const caller = (userId: string) =>
		createCallerFactory(insightsRouter)({
			session: { user: { id: userId, role: "USER", isActive: true } },
			db: adminDb,
			headers: new Headers({ "x-timezone": ZONE }),
		} as never);

	it("summary, months, ytd and cashflow answer for the signed-in user", async () => {
		const c = caller(ana);
		const s = await c.summary({ range: OCT, compare: true });
		expect(s.total.value).toEqual(dkk(38_000));
		expect(s.changePct).toBe(130);
		expect(
			(await c.months({ to: "2026-10-31", count: 2 })).months,
		).toHaveLength(2);
		expect((await c.ytd({})).home).toBe("DKK");
		expect((await c.cashflow({ range: OCT })).income.value).toEqual(
			dkk(170_000),
		);
	});

	it("rejects a range that ends before it starts and days that do not exist", () => {
		expect(
			insightsRangeSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" })
				.success,
		).toBe(false);
		expect(
			insightsRangeSchema.safeParse({ from: "2026-02-30", to: "2026-03-01" })
				.success,
		).toBe(false);
		expect(insightsSummaryInputSchema.parse({ range: OCT })).toEqual({
			range: OCT,
			compare: false,
			filter: {},
		});
	});
});

/**
 * The insights.* figures on a real Postgres. The registry reads them for the
 * default view (this fiscal period, no filters), and that view has to equal
 * what the Insights reads send for the same range, so the numbers are worked
 * out relative to the run date (as glance.pg.test.ts does), never to a fixed
 * one. Home is DKK (USD 1 = 7.00, seeded by the fixture).
 *
 * "fig", fiscal month from the 1st:
 *   this period: DKK 100 Groceries on day 1; USD 10 (DKK 70) Groceries and
 *   DKK 40 Transport today; DKK 1,000 income today.
 *   last period: DKK 60 Groceries on day 1.
 *   -> spent 210.00, Groceries 170.00, Transport 40.00, last period 60.00,
 *      income 1,000.00, saved 790.00.
 * "ytd" (no income, no last-period row):
 *   this year DKK 100 + USD 10 Groceries (frozen USD 15 + 10) and DKK 40
 *   Transport (frozen USD 6): DKK 210.00, USD 31.00.
 *   last year, same calendar day: DKK 25 Groceries (frozen USD 3), and on
 *   January 1 DKK 50 Transport (frozen USD 7): DKK 75.00, USD 10.00.
 */
import { averageMinor } from "@retrospend/domain/insights";
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "@retrospend/domain/fiscal-month";
import { readFigures } from "~/server/figures/read";
import { userTimeZone } from "~/server/services/user-time-zone";
import { adminDb } from "~/test/pg-harness";
import {
	category,
	dkk,
	insightsUser,
	row,
	seedDkkRates,
	usd,
} from "./__tests__/fixture";
import { insightsSummary, insightsYtd } from "./index";

const HOUR = 3_600_000;
let tz: string;
let today: string;
let thisFirst: string;
let lastFirst: string;
let fig: string;
let ytd: string;
let groceries: string;
let transport: string;

/** Noon on a day of the viewer's calendar. */
const noon = (day: string) =>
	new Date(parseDateOnlyIn(day, tz).getTime() + 12 * HOUR).toISOString();

const read = async (userId: string, id: string, narrowing = {}) =>
	(await readFigures(userId, [id], narrowing)).get(id);

beforeAll(async () => {
	await seedDkkRates();
	tz = await userTimeZone(adminDb, null);
	const now = new Date();
	today = dayKey(now, tz);
	const label = getCurrentFiscalMonth(now, 1, tz);
	thisFirst = dayKey(getFiscalMonthRange(label, 1, tz).start, tz);
	lastFirst = dayKey(
		getFiscalMonthRange(shiftMonth(label, -1, tz), 1, tz).start,
		tz,
	);
	const lastYearDay = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
	// February 29 has no twin last year.
	const sameDay = lastYearDay.endsWith("-02-29")
		? `${lastYearDay.slice(0, 8)}28`
		: lastYearDay;

	fig = await insightsUser({ zone: null });
	groceries = await category(fig, "Groceries");
	transport = await category(fig, "Transport");
	await row(fig, {
		at: noon(thisFirst),
		amount: "100",
		usd: "15",
		categoryId: groceries,
	});
	await row(fig, {
		at: noon(today),
		amount: "10",
		currency: "USD",
		usd: "10",
		categoryId: groceries,
	});
	await row(fig, {
		at: noon(today),
		amount: "40",
		usd: "6",
		categoryId: transport,
	});
	await row(fig, {
		at: noon(today),
		amount: "1000",
		usd: "143",
		kind: "income",
	});
	await row(fig, {
		at: noon(lastFirst),
		amount: "60",
		usd: "8",
		categoryId: groceries,
	});

	ytd = await insightsUser({ zone: null });
	const yg = await category(ytd, "Groceries");
	const yt = await category(ytd, "Transport");
	await row(ytd, {
		at: noon(thisFirst),
		amount: "100",
		usd: "15",
		categoryId: yg,
	});
	await row(ytd, {
		at: noon(today),
		amount: "10",
		currency: "USD",
		usd: "10",
		categoryId: yg,
	});
	await row(ytd, { at: noon(today), amount: "40", usd: "6", categoryId: yt });
	await row(ytd, { at: noon(sameDay), amount: "25", usd: "3", categoryId: yg });
	await row(ytd, {
		at: noon(`${Number(today.slice(0, 4)) - 1}-01-01`),
		amount: "50",
		usd: "7",
		categoryId: yt,
	});
});

describe("figure insights.spent", () => {
	it("this period's spending in DKK, the same number the summary sends", async () => {
		expect(await read(fig, "insights.spent")).toEqual([dkk(21_000)]);
		const period = {
			from: thisFirst,
			to: dayKey(
				getFiscalMonthRange(getCurrentFiscalMonth(new Date(), 1, tz), 1, tz)
					.end,
				tz,
			),
		};
		const s = await insightsSummary(adminDb, fig, {
			range: period,
			compare: true,
		});
		expect(s.total.value).toEqual(dkk(21_000));
		expect(s.previousTotal?.value).toEqual(dkk(6_000));
	});

	it("a foreign row with no home rate is unavailable, not 1", async () => {
		const lost = await insightsUser({ zone: null });
		await adminDb.user.update({
			where: { id: lost },
			data: { homeCurrency: "ISK" },
		});
		await row(lost, {
			at: noon(today),
			amount: "10",
			currency: "USD",
			usd: "10",
		});
		expect(await read(lost, "insights.spent")).toBeNull();
	});
});

describe("figure insights.spentPrevious", () => {
	it("the whole month before: DKK 60", async () => {
		expect(await read(fig, "insights.spentPrevious")).toEqual([dkk(6_000)]);
	});
});

describe("figure insights.byCategory", () => {
	it("one category of the period; a category with nothing reads 0", async () => {
		expect(
			await read(fig, "insights.byCategory", { categoryId: groceries }),
		).toEqual([dkk(17_000)]);
		expect(
			await read(fig, "insights.byCategory", { categoryId: transport }),
		).toEqual([dkk(4_000)]);
		expect(
			await read(fig, "insights.byCategory", { categoryId: "nothing" }),
		).toEqual([dkk(0)]);
	});

	it("without a category it is not a number", async () => {
		expect(await read(fig, "insights.byCategory")).toBeNull();
	});
});

describe("figure insights.byMonth", () => {
	it("a fiscal month by its label; this month when none is given", async () => {
		expect(await read(fig, "insights.byMonth")).toEqual([dkk(21_000)]);
		expect(
			await read(fig, "insights.byMonth", { month: lastFirst.slice(0, 7) }),
		).toEqual([dkk(6_000)]);
		expect(
			await read(fig, "insights.byMonth", { month: thisFirst.slice(0, 7) }),
		).toEqual([dkk(21_000)]);
	});
});

describe("figure insights.income", () => {
	it("money in this period: DKK 1,000", async () => {
		expect(await read(fig, "insights.income")).toEqual([dkk(100_000)]);
	});
});

describe("figure insights.saved", () => {
	it("income minus spending, signed: 1,000 - 210 = DKK 790", async () => {
		expect(await read(fig, "insights.saved")).toEqual([dkk(79_000)]);
		expect(await read(ytd, "insights.saved")).toEqual([dkk(-21_000)]);
	});
});

describe("figure insights.dailyAverage", () => {
	it("spending over the days elapsed this period", async () => {
		const days = Number(today.slice(8));
		expect(await read(fig, "insights.dailyAverage")).toEqual([
			dkk(averageMinor(21_000, days)),
		]);
	});
});

describe("figure insights.monthlyAverage", () => {
	it("spending over the one month the period touches", async () => {
		expect(await read(fig, "insights.monthlyAverage")).toEqual([dkk(21_000)]);
	});
});

describe("figure insights.ytd", () => {
	it("this year to today in DKK, equal to what the ytd read sends", async () => {
		expect(await read(ytd, "insights.ytd")).toEqual([dkk(21_000)]);
		const y = await insightsYtd(adminDb, ytd, {});
		expect(y.total.home.value).toEqual(dkk(21_000));
	});
});

describe("figure insights.ytdLastYear", () => {
	it("the same span last year in DKK: 25 + 50", async () => {
		expect(await read(ytd, "insights.ytdLastYear")).toEqual([dkk(7_500)]);
	});
});

describe("figure insights.ytdByCategory", () => {
	it("one category of the year to date", async () => {
		const cats = (await insightsYtd(adminDb, ytd, {})).categories;
		const g =
			cats.find((c) => c.value.home?.minor === 17_000)?.categoryId ?? "";
		expect(
			await read(ytd, "insights.ytdByCategory", { categoryId: g }),
		).toEqual([dkk(17_000)]);
		expect(await read(ytd, "insights.ytdByCategory")).toBeNull();
	});
});

describe("figure insights.ytdUsd", () => {
	it("this year at the stored USD values: 15 + 10 + 6", async () => {
		expect(await read(ytd, "insights.ytdUsd")).toEqual([usd(3_100)]);
	});
});

describe("figure insights.ytdLastYearUsd", () => {
	it("last year at the stored USD values: 3 + 7", async () => {
		expect(await read(ytd, "insights.ytdLastYearUsd")).toEqual([usd(1_000)]);
	});
});

describe("figure insights.ytdByCategoryUsd", () => {
	it("one category in USD", async () => {
		const cats = (await insightsYtd(adminDb, ytd, {})).categories;
		const g =
			cats.find((c) => c.value.home?.minor === 17_000)?.categoryId ?? "";
		expect(
			await read(ytd, "insights.ytdByCategoryUsd", { categoryId: g }),
		).toEqual([usd(2_500)]);
	});
});

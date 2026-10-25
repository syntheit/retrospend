/**
 * Insights with a fiscal start day, and its agreement with Activity's footer,
 * on a real Postgres, worked out by hand. "Now" is 2026-10-24 12:00 in
 * Buenos Aires. DKK is USD 1 = 7.00 (fixture); CZK has its own two rates.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "~/lib/fiscal-month";
import { readFigures } from "~/server/figures/read";
import { listActivity } from "~/server/services/expense-list";
import { listV2Input } from "~/server/services/expense-list/types";
import { userTimeZone } from "~/server/services/user-time-zone";
import { adminDb } from "~/test/pg-harness";
import { dkk, insightsUser, row, seedDkkRates } from "./__tests__/fixture";
import { insightsCashflow, insightsSummary } from "./index";

const NOW = new Date("2026-10-24T15:00:00Z");
const at = { now: NOW } as const;

beforeAll(seedDkkRates);

describe("a fiscal start day of 15", () => {
	// Fiscal October is Oct 15 to Nov 14; Sep 14 belongs to the period before
	// last, not to the one before October.
	it("compares a fiscal period with the fiscal period before it", async () => {
		const mid = await insightsUser({ startDay: 15 });
		await row(mid, {
			at: "2026-09-14T12:00:00-03:00",
			amount: "555",
			usd: "80",
		});
		await row(mid, {
			at: "2026-09-20T12:00:00-03:00",
			amount: "100",
			usd: "14",
		});
		await row(mid, {
			at: "2026-10-14T12:00:00-03:00",
			amount: "77",
			usd: "11",
		});
		await row(mid, {
			at: "2026-10-20T12:00:00-03:00",
			amount: "300",
			usd: "43",
		});
		const range = { from: "2026-10-15", to: "2026-11-14" };
		const s = await insightsSummary(adminDb, mid, { range, compare: true }, at);
		expect(s.previousRange).toEqual({ from: "2026-09-15", to: "2026-10-14" });
		// Sep 20 DKK 100 and Oct 14 DKK 77; the Sep 14 DKK 555 is out.
		expect(s.previousTotal?.value).toEqual(dkk(17_700));
		expect(s.total.value).toEqual(dkk(30_000));
		expect(s.changePct).toBe(69); // 69.49
	});

	it("a monthly average divides by fiscal periods, not calendar months", async () => {
		const spender = await insightsUser({ startDay: 15 });
		await row(spender, {
			at: "2026-10-20T12:00:00-03:00",
			amount: "60",
			usd: "9",
		});
		const one = await insightsCashflow(
			adminDb,
			spender,
			{ range: { from: "2026-10-15", to: "2026-11-14" } },
			at,
		);
		// One fiscal month that touches two calendar months: DKK 60.00, not 30.00.
		expect(one.monthlyAverage.value).toEqual(dkk(6_000));
		const two = await insightsCashflow(
			adminDb,
			spender,
			{ range: { from: "2026-10-15", to: "2026-12-14" } },
			at,
		);
		expect(two.monthlyAverage.value).toEqual(dkk(3_000));
	});
});

describe("Activity's footer and Insights", () => {
	it("agree for a past month with an unbooked foreign row", async () => {
		// CZK per USD: 20 on Sep 1, 25 on Oct 1. In UTC days September ends at
		// 23:59:59.999Z on the 30th and reads the Sep 1 rate, not today's.
		for (const [date, rate] of [
			["2026-09-01T00:00:00.000Z", "20"],
			["2026-10-01T00:00:00.000Z", "25"],
		] as const) {
			const day = new Date(date);
			await adminDb.exchangeRate.upsert({
				where: {
					date_currency_type: { date: day, currency: "CZK", type: "official" },
				},
				create: { date: day, currency: "CZK", type: "official", rate },
				update: {},
			});
		}
		const id = await insightsUser({ zone: "UTC" });
		await adminDb.user.update({ where: { id }, data: { homeCurrency: "CZK" } });
		await row(id, {
			at: "2026-09-10T12:00:00Z",
			amount: "10",
			currency: "USD",
			usd: "10",
		});
		await row(id, {
			at: "2026-09-11T12:00:00Z",
			amount: "50",
			currency: "CZK",
			usd: "2",
		});
		const month = { from: "2026-09-01", to: "2026-09-30" };
		const insights = await insightsSummary(
			adminDb,
			id,
			{ range: month, compare: false },
			at,
		);
		// USD 10 at 20 = CZK 200, plus CZK 50: 250.00 (at 25 it would be 300.00).
		expect(insights.total.value).toEqual({ minor: 25_000, currency: "CZK" });
		const list = await listActivity(
			adminDb,
			id,
			listV2Input.parse(month),
			"UTC",
			NOW,
		);
		expect(list.total?.value).toEqual(insights.total.value);
	});
});

describe("the default view with a fiscal start day of 15", () => {
	it("insights.spentPrevious is the fiscal period before this one, insights.monthlyAverage is this one period", async () => {
		const tz = await userTimeZone(adminDb, null);
		const label = getCurrentFiscalMonth(new Date(), 15, tz);
		const current = getFiscalMonthRange(label, 15, tz);
		const last = getFiscalMonthRange(shiftMonth(label, -1, tz), 15, tz);
		const hours = (d: Date, h: number) =>
			new Date(d.getTime() + h * 3_600_000).toISOString();
		const id = await insightsUser({ zone: null, startDay: 15 });
		// The first day of last period is in it; the day before is not.
		await row(id, { at: hours(last.start, 12), amount: "40", usd: "6" });
		await row(id, { at: hours(last.start, -12), amount: "900", usd: "130" });
		await row(id, { at: hours(current.start, 12), amount: "60", usd: "9" });
		const read = async (figure: string) =>
			(await readFigures(id, [figure])).get(figure);
		expect(await read("insights.spentPrevious")).toEqual([dkk(4_000)]);
		expect(await read("insights.spent")).toEqual([dkk(6_000)]);
		expect(await read("insights.monthlyAverage")).toEqual([dkk(6_000)]);
	});
});

import type { RetrospendClient } from "@retrospend/api-client";
import { type RangeWords, rangeLabel } from "./labels";
import { barShares, categoryRows, highlightIndex, ytdRows } from "./rows";
import {
	fetchInsights,
	type InsightsSummary,
	type InsightsYtd,
} from "./source";
import {
	DEFAULT_VIEW,
	filterParams,
	isNarrowed,
	spanOf,
	viewKey,
} from "./view";

const dkk = (minor: number) => ({ minor, currency: "DKK" });
const usd = (minor: number) => ({ minor, currency: "USD" });

describe("view", () => {
	it("turns each period into days of the phone's calendar", () => {
		expect(spanOf("month", "2026-10-29", null)).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(spanOf("lastMonth", "2026-03-31", null)).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
		expect(spanOf("lastMonth", "2026-01-15", null)).toEqual({
			from: "2025-12-01",
			to: "2025-12-31",
		});
		expect(spanOf("year", "2026-10-29", null)).toEqual({
			from: "2026-01-01",
			to: "2026-12-31",
		});
	});

	it("starts All time at the oldest spending, or today with none", () => {
		expect(spanOf("all", "2026-10-29", "2024-05-02")).toEqual({
			from: "2024-05-02",
			to: "2026-10-29",
		});
		expect(spanOf("all", "2026-10-29", null)).toEqual({
			from: "2026-10-29",
			to: "2026-10-29",
		});
	});

	it("sends a chip only when it is set", () => {
		expect(filterParams(DEFAULT_VIEW)).toEqual({});
		expect(isNarrowed(DEFAULT_VIEW)).toBe(false);
		const view = { ...DEFAULT_VIEW, categoryId: "c1", personKey: "user:u1" };
		expect(filterParams(view)).toEqual({ cat: "c1", person: "user:u1" });
		expect(isNarrowed(view)).toBe(true);
	});

	it("keys the cache by day and by every pick", () => {
		const a = viewKey(DEFAULT_VIEW, "2026-10-29");
		expect(a.startsWith("insights:")).toBe(true);
		expect(viewKey(DEFAULT_VIEW, "2026-10-30")).not.toBe(a);
		expect(viewKey({ ...DEFAULT_VIEW, compare: true }, "2026-10-29")).not.toBe(
			a,
		);
		expect(
			viewKey({ ...DEFAULT_VIEW, categoryId: "c1" }, "2026-10-29"),
		).not.toBe(a);
	});
});

describe("rangeLabel", () => {
	const words: RangeWords = {
		month: (d) => `M(${d.slice(0, 7)})`,
		day: (d) => `D(${d.slice(5)})`,
		dayWithYear: (d) => `D(${d})`,
		span: (from, to) => `${from} to ${to}`,
	};
	const today = "2026-10-29";

	it("names a whole month and a whole year", () => {
		expect(
			rangeLabel({ from: "2026-02-01", to: "2026-02-28" }, today, words),
		).toBe("M(2026-02)");
		expect(
			rangeLabel({ from: "2025-01-01", to: "2025-12-31" }, today, words),
		).toBe("2025");
	});

	it("gives other spans both ends, with the year when it is not this one", () => {
		expect(
			rangeLabel({ from: "2026-01-01", to: "2026-10-29" }, today, words),
		).toBe("D(01-01) to D(10-29)");
		expect(
			rangeLabel({ from: "2025-01-01", to: "2025-10-29" }, today, words),
		).toBe("D(2025-01-01) to D(2025-10-29)");
		expect(
			rangeLabel({ from: "2026-10-29", to: "2026-10-29" }, today, words),
		).toBe("D(10-29)");
	});
});

describe("rows", () => {
	const refs = new Map([
		["g", { name: "Groceries", icon: null, tone: 3 }],
		["t", { name: "Transport", icon: "Bus", tone: 7 }],
	]);
	const row = (
		categoryId: string | null,
		value: ReturnType<typeof dkk> | null,
		changePct: number | null,
	): InsightsSummary["categories"][number] => ({
		categoryId,
		figure: "insights.byCategory",
		value,
		previous: null,
		changePct,
	});

	it("keeps the server's order and puts rows with no rate last", () => {
		const rows = categoryRows(
			[
				row("g", dkk(17_000), 31),
				row("x", null, null),
				row(null, dkk(7_000), null),
			],
			refs,
			false,
		);
		expect(rows.map((r) => r.id)).toEqual(["g", "none", "x"]);
		expect(rows[0]?.category?.name).toBe("Groceries");
		// A category the phone does not know reads as No category, never an id.
		expect(rows[2]?.category).toBeNull();
		expect(rows.every((r) => r.change === undefined)).toBe(true);
	});

	it("notes the change only with Compare on and an amount", () => {
		const rows = categoryRows(
			[row("g", dkk(17_000), 31), row("t", dkk(100), null), row("x", null, 5)],
			refs,
			true,
		);
		expect(rows.map((r) => r.change)).toEqual([31, null, undefined]);
	});

	it("orders year to date by the server's USD place in USD", () => {
		const ytd = (
			categoryId: string,
			home: number,
			dollars: number | null,
			usdRank: number,
		): InsightsYtd["categories"][number] => ({
			categoryId,
			figure: "insights.ytdByCategory",
			usdFigure: "insights.ytdByCategoryUsd",
			value: { home: dkk(home), usd: dollars === null ? null : usd(dollars) },
			lastYear: { home: null, usd: null },
			usdRank,
			changePct: 10,
			usdChangePct: 20,
		});
		const data = [
			ytd("g", 700, 100, 1),
			ytd("t", 500, 200, 0),
			ytd("x", 1, null, 2),
		];
		expect(ytdRows(data, refs, false).map((r) => [r.id, r.change])).toEqual([
			["g", 10],
			["t", 10],
			["x", 10],
		]);
		expect(ytdRows(data, refs, true).map((r) => [r.id, r.change])).toEqual([
			["t", 20],
			["g", 20],
			["x", undefined],
		]);
	});

	it("draws bars against the longest, with no bar for a gap", () => {
		expect(barShares([dkk(200), dkk(50), null, dkk(0)])).toEqual([
			1, 0.25, 0, 0,
		]);
		expect(barShares([null, null])).toEqual([0, 0]);
	});

	it("highlights the month the range ends in, else the last", () => {
		const months = [
			{ month: "2026-09" },
			{ month: "2026-10" },
			{ month: "2026-11" },
		];
		expect(highlightIndex(months, "2026-10-31")).toBe(1);
		expect(highlightIndex(months, "2027-01-31")).toBe(2);
	});
});

describe("fetchInsights", () => {
	function fakeApi() {
		const calls: Record<string, unknown[]> = {};
		const record =
			(name: string, answer: unknown) =>
			async (input?: unknown): Promise<unknown> => {
				calls[name] = [...(calls[name] ?? []), input];
				return answer;
			};
		const api = {
			figures: {
				firstDay: record("firstDay", { day: "2025-03-04" }),
				insightsSummary: record("summary", { count: 1 }),
				insightsMonths: record("months", { months: [] }),
				insightsYtd: record("ytd", { categories: [] }),
				insightsCashflow: record("cashflow", { income: null }),
			},
		} as unknown as RetrospendClient;
		return { api, calls };
	}

	it("asks the four reads for this month, with no first day", async () => {
		const { api, calls } = fakeApi();
		const data = await fetchInsights(api, DEFAULT_VIEW, "2026-10-29")();
		expect(calls.firstDay).toBeUndefined();
		expect(calls.summary).toEqual([{ from: "2026-10-01", to: "2026-10-31" }]);
		expect(calls.months).toEqual([{ to: "2026-10-31", count: 6 }]);
		expect(calls.ytd).toEqual([{}]);
		expect(calls.cashflow).toEqual([{ from: "2026-10-01", to: "2026-10-31" }]);
		expect(data.cashflow).not.toBeNull();
	});

	it("starts All time at the first day and skips cashflow with a chip", async () => {
		const { api, calls } = fakeApi();
		const data = await fetchInsights(
			api,
			{ period: "all", compare: true, categoryId: "c1", personKey: null },
			"2026-10-29",
		)();
		expect(calls.summary).toEqual([
			{ from: "2025-03-04", to: "2026-10-29", compare: "true", cat: "c1" },
		]);
		expect(calls.ytd).toEqual([{ cat: "c1" }]);
		expect(calls.cashflow).toBeUndefined();
		expect(data.cashflow).toBeNull();
		expect(data.span).toEqual({ from: "2025-03-04", to: "2026-10-29" });
	});
});

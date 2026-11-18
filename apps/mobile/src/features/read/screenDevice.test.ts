import type { RetrospendClient } from "@retrospend/api-client";
import type { CompareReport } from "@retrospend/engine/device";
import { fetchInsights, type InsightsData } from "@/features/insights/source";
import { DEFAULT_VIEW } from "@/features/insights/view";
import { fetchRecurring } from "@/features/recurring/source";
import { fetchWealth } from "@/features/wealth/source";

// Wealth, Recurring and Insights with the dev flag's device engine: each
// screen is the server's answer, whatever the device holds, and the device is
// asked to compare the screen with the ids the screen lists. Only Insights'
// default view is compared.

// A device that differs from the server on every key: the screens still show the server's.
const device = () => ({
	compare: jest.fn(
		async () =>
			({ state: "checked", differs: ["x"] }) as unknown as CompareReport,
	),
});

describe("Wealth", () => {
	const list = { accounts: [{ id: "a1" }, { id: "a2" }] };
	const reads = {
		list: { accounts: list.accounts },
		netWorth: { series: [] },
		summary: { groups: [] },
		order: { sort: "manual" },
	};
	const api = {
		accounts: {
			list: async () => reads.list,
			netWorth: async () => reads.netWorth,
			summary: async () => reads.summary,
			order: async () => reads.order,
		},
	} as unknown as RetrospendClient;

	it("shows the server's reads and compares with the account ids", async () => {
		const source = device();
		const data = await fetchWealth(api, source)();
		expect(data).toEqual(reads);
		expect(data.list).toBe(reads.list);
		expect(source.compare).toHaveBeenCalledWith("wealth", {
			accountId: ["a1", "a2"],
		});
	});

	it("is today's call with no device", async () => {
		for (const none of [undefined, null])
			expect(await fetchWealth(api, none)()).toEqual(reads);
	});
});

describe("Recurring", () => {
	const items = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
	const summary = { cost: [] };
	const api = {
		recurring: {
			list: async () => ({ items }),
			summary: async () => summary,
		},
	} as unknown as RetrospendClient;

	it("shows the server's reads and compares with the template ids", async () => {
		const source = device();
		const data = await fetchRecurring(api, source)();
		expect(data.items).toBe(items);
		expect(data.summary).toBe(summary);
		expect(source.compare).toHaveBeenCalledWith("recurring", {
			recurringId: ["r1", "r2", "r3"],
		});
	});

	it("is today's call with no device", async () => {
		expect((await fetchRecurring(api, null)()).items).toBe(items);
	});
});

describe("Insights", () => {
	const summary = {
		categories: [
			{ categoryId: "c1" },
			{ categoryId: null },
			{ categoryId: "c2" },
		],
	};
	const months = { months: [{ month: "2026-09" }, { month: "2026-10" }] };
	const ytd = { categories: [{ categoryId: "c2" }, { categoryId: "c3" }] };
	const api = {
		figures: {
			firstDay: async () => ({ day: "2026-01-02" }),
			insightsSummary: async () => summary,
			insightsMonths: async () => months,
			insightsYtd: async () => ytd,
			insightsCashflow: async () => ({}),
		},
	} as unknown as RetrospendClient;
	const read = (
		view: Parameters<typeof fetchInsights>[1],
		source?: ReturnType<typeof device> | null,
	) => fetchInsights(api, view, "2026-10-15", source)();

	it("shows the server's reads and compares with its category ids and month labels", async () => {
		const source = device();
		const data: InsightsData = await read(DEFAULT_VIEW, source);
		expect(data.summary).toBe(summary);
		expect(data.months).toBe(months);
		expect(data.ytd).toBe(ytd);
		// Both lists, each id once, no uncategorized row.
		expect(source.compare).toHaveBeenCalledWith("insights", {
			categoryId: ["c1", "c2", "c3"],
			month: ["2026-09", "2026-10"],
		});
	});

	it.each([
		["another period", { ...DEFAULT_VIEW, period: "year" as const }],
		["last month", { ...DEFAULT_VIEW, period: "lastMonth" as const }],
		["all time", { ...DEFAULT_VIEW, period: "all" as const }],
		["Compare on", { ...DEFAULT_VIEW, compare: true }],
		["a category chip", { ...DEFAULT_VIEW, categoryId: "c1" }],
		["a person chip", { ...DEFAULT_VIEW, personKey: "user:u1" }],
	])("is not compared with %s", async (_name, view) => {
		const source = device();
		await read(view, source);
		expect(source.compare).not.toHaveBeenCalled();
	});

	it("is today's call with no device", async () => {
		expect((await read(DEFAULT_VIEW, null)).summary).toBe(summary);
	});
});

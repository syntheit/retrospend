import { describe, expect, it } from "vitest";
import type { InsightsView } from "~/features/insights/filter";
import {
	budgetValues,
	insightsValues,
	isDefaultInsightsView,
	recurringValues,
	wealthValues,
} from "../narrowings";

const month = {
	groups: [
		{ envelopes: [{ id: "e1" }, { id: "e2" }] },
		{ envelopes: [] },
		{ envelopes: [{ id: "e3" }] },
	],
};

describe("what each screen hands the compare", () => {
	it("Budget: every envelope of the current month, nothing for another month or before it loads", () => {
		expect(budgetValues(month, true)).toEqual({
			envelopeId: ["e1", "e2", "e3"],
		});
		expect(budgetValues(month, false)).toBeNull();
		expect(budgetValues(null, true)).toBeNull();
	});

	it("Wealth: the open accounts of every group", () => {
		expect(
			wealthValues({
				groups: [{ accounts: [{ id: "a1" }] }, { accounts: [{ id: "a2" }] }],
			}),
		).toEqual({ accountId: ["a1", "a2"] });
	});

	it("Recurring: the templates, once loaded", () => {
		expect(recurringValues({ items: [{ id: "r1" }, { id: "r2" }] })).toEqual({
			recurringId: ["r1", "r2"],
		});
		expect(recurringValues(undefined)).toBeNull();
	});

	it("Insights: the ranked categories (never the uncategorized row) and the bars' months, on the default view only", () => {
		const summary = {
			categories: [
				{ categoryId: "c1" },
				{ categoryId: null },
				{ categoryId: "c2" },
			],
		};
		const months = { months: [{ month: "2026-10" }, { month: "2026-11" }] };
		expect(insightsValues(summary, months, true)).toEqual({
			categoryId: ["c1", "c2"],
			month: ["2026-10", "2026-11"],
		});
		expect(insightsValues(summary, months, false)).toBeNull();
		expect(insightsValues(summary, undefined, true)).toBeNull();
		expect(insightsValues(undefined, months, true)).toBeNull();
	});
});

describe("Insights default view: the fiscal period the figures read", () => {
	const view = (from: string | null, to: string | null): InsightsView => ({
		range: { from, to },
		compare: false,
		cats: [],
		people: [],
		projects: [],
	});
	const settled = { summary: false, months: false };

	it("start day 1 is the calendar month", () => {
		expect(
			isDefaultInsightsView(
				view("2026-11-01", "2026-11-30"),
				"2026-11-20",
				1,
				settled,
			),
		).toBe(true);
	});

	// Hand-derived: with start day 15, Nov 20 is in Nov 15 to Dec 14, Nov 10 in Oct 15 to Nov 14.
	it("start day 15 on Nov 20 is Nov 15 to Dec 14, not the calendar month", () => {
		expect(
			isDefaultInsightsView(
				view("2026-11-15", "2026-12-14"),
				"2026-11-20",
				15,
				settled,
			),
		).toBe(true);
		expect(
			isDefaultInsightsView(
				view("2026-11-01", "2026-11-30"),
				"2026-11-20",
				15,
				settled,
			),
		).toBe(false);
	});

	it("start day 15 on Nov 10 is Oct 15 to Nov 14", () => {
		expect(
			isDefaultInsightsView(
				view("2026-10-15", "2026-11-14"),
				"2026-11-10",
				15,
				settled,
			),
		).toBe(true);
		expect(
			isDefaultInsightsView(
				view("2026-11-15", "2026-12-14"),
				"2026-11-10",
				15,
				settled,
			),
		).toBe(false);
	});

	it("is not the default with a chip picked, an answer still the last view's, or no start day yet", () => {
		const month = view("2026-11-01", "2026-11-30");
		expect(
			isDefaultInsightsView(
				{ ...month, cats: ["c1"] },
				"2026-11-20",
				1,
				settled,
			),
		).toBe(false);
		expect(
			isDefaultInsightsView(month, "2026-11-20", 1, {
				summary: true,
				months: false,
			}),
		).toBe(false);
		expect(
			isDefaultInsightsView(month, "2026-11-20", 1, {
				summary: false,
				months: true,
			}),
		).toBe(false);
		expect(isDefaultInsightsView(month, "2026-11-20", undefined, settled)).toBe(
			false,
		);
	});

	it("all time is never the default", () => {
		expect(
			isDefaultInsightsView(view(null, null), "2026-11-20", 1, settled),
		).toBe(false);
	});
});

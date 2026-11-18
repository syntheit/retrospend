import { describe, expect, it } from "vitest";
import {
	budgetValues,
	insightsValues,
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

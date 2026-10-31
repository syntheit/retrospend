import { describe, expect, it } from "vitest";
import { promotedActions } from "./header-actions";
import type { BudgetActions } from "./use-budget-actions";

const all = { can: () => true } as unknown as BudgetActions;
const none = { can: () => false } as unknown as BudgetActions;
const live = { readOnly: false, planning: false, isCurrent: true, phone: false };

describe("promotedActions", () => {
	it("an open month on desktop shows all three as buttons", () => {
		expect(promotedActions({ actions: all, ...live })).toEqual({
			income: true,
			plan: true,
			whatIf: true,
		});
	});

	it("Plan next month is offered from this month only", () => {
		expect(
			promotedActions({ actions: all, ...live, isCurrent: false }).plan,
		).toBe(false);
	});

	it("a phone keeps two trailing buttons: Add money in and the menu", () => {
		expect(promotedActions({ actions: all, ...live, phone: true })).toEqual({
			income: true,
			plan: false,
			whatIf: false,
		});
	});

	it("a closed month and the plan itself show no buttons", () => {
		const off = { income: false, plan: false, whatIf: false };
		expect(promotedActions({ actions: all, ...live, readOnly: true })).toEqual(
			off,
		);
		expect(promotedActions({ actions: all, ...live, planning: true })).toEqual(
			off,
		);
	});

	it("a sheet that does not exist is not offered", () => {
		expect(promotedActions({ actions: none, ...live })).toEqual({
			income: false,
			plan: true,
			whatIf: false,
		});
	});
});

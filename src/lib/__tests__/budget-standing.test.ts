import { describe, expect, it } from "vitest";
import { budgetStanding, budgetStandingVariant } from "~/lib/budget-standing";

describe("budgetStanding", () => {
	it("reports the actual overage, not the projection", () => {
		// The staging case: AR$2,500,650 spent of AR$2,220,000 on day 21 of 31
		const standing = budgetStanding({
			totalBudget: 2_220_000,
			totalSpent: 2_500_650,
			currentDay: 21,
			daysInMonth: 31,
		});
		expect(standing?.difference).toBe(280_650);
		expect(standing?.usedPct).toBeCloseTo(112.64, 2);
		// The pace figure the card used to show as "over budget"
		expect((standing?.projectedSpend ?? 0) - 2_220_000).toBeCloseTo(1_471_436, 0);
	});

	it("is negative while under budget", () => {
		const standing = budgetStanding({
			totalBudget: 1000,
			totalSpent: 400,
			currentDay: 10,
			daysInMonth: 30,
		});
		expect(standing?.difference).toBe(-600);
	});

	it("has no standing without a budget", () => {
		expect(
			budgetStanding({ totalBudget: 0, totalSpent: 50, currentDay: 3, daysInMonth: 30 }),
		).toBeNull();
	});

	it("has no projection before the first day counts", () => {
		const standing = budgetStanding({
			totalBudget: 1000,
			totalSpent: 0,
			currentDay: 0,
			daysInMonth: 30,
		});
		expect(standing?.projectedSpend).toBeNull();
	});
});

describe("budgetStandingVariant", () => {
	const at = (totalSpent: number, currentDay: number) =>
		budgetStandingVariant(
			budgetStanding({ totalBudget: 1000, totalSpent, currentDay, daysInMonth: 30 })!,
		);

	it("warns when on pace to go over even while still under", () => {
		expect(at(600, 15)).toBe("rose"); // projected 1200
	});

	it("is amber close to the limit and green with room", () => {
		expect(at(475, 15)).toBe("amber"); // projected 950
		expect(at(300, 15)).toBe("emerald"); // projected 600
	});

	it("stays red once actually over, whatever the pace", () => {
		expect(at(1100, 30)).toBe("rose");
	});
});

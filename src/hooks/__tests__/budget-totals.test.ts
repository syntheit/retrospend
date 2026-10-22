import { describe, expect, it } from "vitest";
import { budgetTotalsInHome } from "~/hooks/use-budget-calculations";
import type { Budget } from "~/types/budget-types";

const ARS_PER_USD = 1500;

function budget(overrides: Partial<Budget>): Budget {
	return {
		id: "b",
		amount: 0,
		amountInUSD: 0,
		currency: "ARS",
		actualSpend: 0,
		actualSpendInUSD: 0,
		effectiveAmount: 0,
		effectiveAmountInUSD: 0,
		amountInHome: 0,
		actualSpendInHome: 0,
		effectiveAmountInHome: 0,
		pegToActual: false,
		type: "FIXED",
		category: { id: "c", name: "Food", color: "blue" },
		...overrides,
	};
}

describe("budgetTotalsInHome", () => {
	it("adds home-currency figures, not each budget's own amounts", () => {
		// Home currency ARS: an ARS budget and a USD budget
		const ars = budget({
			currency: "ARS",
			amount: 300_000,
			effectiveAmount: 300_000,
			actualSpend: 120_000,
			amountInHome: 300_000,
			effectiveAmountInHome: 300_000,
			actualSpendInHome: 120_000,
		});
		const usd = budget({
			currency: "USD",
			amount: 200,
			effectiveAmount: 200,
			actualSpend: 50,
			amountInHome: 200 * ARS_PER_USD,
			effectiveAmountInHome: 200 * ARS_PER_USD,
			actualSpendInHome: 50 * ARS_PER_USD,
		});

		const totals = budgetTotalsInHome([ars, usd]);
		expect(totals.allocated).toBe(300_000 + 200 * ARS_PER_USD);
		expect(totals.spent).toBe(120_000 + 50 * ARS_PER_USD);
		// The bug: 300_000 + 200 printed as ARS
		expect(totals.allocated).not.toBe(300_200);
	});

	it("allocates a pegged budget at its pegged figure", () => {
		const pegged = budget({
			type: "PEG_TO_ACTUAL",
			pegToActual: true,
			currency: "USD",
			amount: 0,
			effectiveAmount: 40,
			actualSpend: 40,
			amountInHome: 0,
			effectiveAmountInHome: 40 * ARS_PER_USD,
			actualSpendInHome: 40 * ARS_PER_USD,
		});
		expect(budgetTotalsInHome([pegged])).toEqual({
			allocated: 40 * ARS_PER_USD,
			spent: 40 * ARS_PER_USD,
		});
	});

	it("is zero for no budgets", () => {
		expect(budgetTotalsInHome([])).toEqual({ allocated: 0, spent: 0 });
	});
});

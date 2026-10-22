import { useMemo } from "react";
import type { Budget } from "~/types/budget-types";

interface UseBudgetCalculationsProps {
	budgets: Budget[];
}

type HomeFigures = Pick<
	Budget,
	"actualSpendInHome" | "effectiveAmountInHome"
>;

/**
 * Allocated and spent for a group of budgets, in the home currency.
 *
 * Budgets can be in different currencies, so their own amounts must never be
 * added together. Each budget carries home-currency figures the server
 * computed under the totals rule (~/lib/money sumIn with the period's rate):
 * an amount already in the home currency counts as entered, any other is
 * converted, and a missing rate fails with MissingRateError instead of
 * becoming 1. Allocation is the effective amount, which is the limit for a
 * fixed budget and the pegged figure for a pegged one.
 */
export function budgetTotalsInHome(budgets: readonly HomeFigures[]): {
	allocated: number;
	spent: number;
} {
	let allocated = 0;
	let spent = 0;
	for (const budget of budgets) {
		allocated += Number(budget.effectiveAmountInHome);
		spent += Number(budget.actualSpendInHome);
	}
	return { allocated, spent };
}

export function useBudgetCalculations({ budgets }: UseBudgetCalculationsProps) {
	return useMemo(() => {
		const validBudgets = budgets.filter((b) => b.category !== null);

		// Budgets can be in different currencies: totals add the home-currency
		// figures the server computed for each budget.
		const totalSpent = validBudgets.reduce(
			(sum, b) => sum + Number(b.actualSpendInHome),
			0,
		);

		const totalAllocated = validBudgets.reduce(
			(sum, b) =>
				sum + Number(b.pegToActual ? b.effectiveAmountInHome : b.amountInHome),
			0,
		);

		const displayAmount = totalAllocated;
		const remaining = displayAmount - totalSpent;
		const isOverBudget = remaining < 0;
		const percentUsed =
			displayAmount > 0 ? (totalSpent / displayAmount) * 100 : 0;

		const variableBudgets = validBudgets
			.filter(
				(b) =>
					!b.pegToActual && (b.type === "FIXED" || (!b.type && !b.pegToActual)),
			)
			.sort((a, b) => b.actualSpendInHome - a.actualSpendInHome);

		const fixedBudgets = validBudgets
			.filter(
				(b) =>
					b.pegToActual ||
					b.type === "PEG_TO_ACTUAL" ||
					(b.type === "PEG_TO_LAST_MONTH" && b.actualSpend > 0) ||
					(!b.type && b.pegToActual),
			)
			.sort((a, b) => b.actualSpendInHome - a.actualSpendInHome);

		const overBudgetCategories = validBudgets.filter(
			(b) =>
				Number(b.actualSpend) >
				Number(b.pegToActual ? b.effectiveAmount : b.amount),
		).length;

		const stats = {
			totalCategories: validBudgets.length,
			overBudgetCategories,
			underBudgetCategories: validBudgets.length - overBudgetCategories,
			unallocatedAmount: 0,
		};

		return {
			validBudgets,
			totalSpent,
			totalAllocated,
			displayAmount,
			remaining,
			isOverBudget,
			percentUsed,
			variableBudgets,
			fixedBudgets,
			stats,
		};
	}, [budgets]);
}

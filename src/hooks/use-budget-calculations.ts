import { useMemo } from "react";
import type { Budget } from "~/types/budget-types";

interface UseBudgetCalculationsProps {
	budgets: Budget[];
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
			.sort((a, b) => b.actualSpend - a.actualSpend);

		const fixedBudgets = validBudgets
			.filter(
				(b) =>
					b.pegToActual ||
					b.type === "PEG_TO_ACTUAL" ||
					(b.type === "PEG_TO_LAST_MONTH" && b.actualSpend > 0) ||
					(!b.type && b.pegToActual),
			)
			.sort((a, b) => b.actualSpend - a.actualSpend);

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

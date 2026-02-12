import { useMemo } from "react";
import type { Budget } from "~/types/budget-types";

interface UseBudgetCalculationsProps {
	budgets: Budget[];
}

export function useBudgetCalculations({
	budgets,
}: UseBudgetCalculationsProps) {
	return useMemo(() => {
		const validBudgets = budgets.filter((b) => b.category !== null);

		// Use USD amounts for aggregation (consistent unit)
		const totalSpentInUSD = validBudgets.reduce(
			(sum, b) => sum + Number(b.actualSpendInUSD),
			0,
		);

		const totalAllocatedInUSD = validBudgets.reduce(
			(sum, b) =>
				sum + Number(b.pegToActual ? b.effectiveAmountInUSD : b.amountInUSD),
			0,
		);

		const displayAmountInUSD = totalAllocatedInUSD;
		const remainingInUSD = displayAmountInUSD - totalSpentInUSD;
		const isOverBudget = remainingInUSD < 0;
		const percentUsed =
			displayAmountInUSD > 0 ? (totalSpentInUSD / displayAmountInUSD) * 100 : 0;

		// Also keep per-budget currency values for display
		const totalSpent = validBudgets.reduce(
			(sum, b) => sum + Number(b.actualSpend),
			0,
		);

		const totalAllocated = validBudgets.reduce(
			(sum, b) => sum + Number(b.pegToActual ? b.effectiveAmount : b.amount),
			0,
		);

		const displayAmount = totalAllocated;
		const remaining = displayAmount - totalSpent;

		const variableBudgets = validBudgets
			.filter((b) => !b.pegToActual)
			.sort((a, b) => b.actualSpend - a.actualSpend);

		const fixedBudgets = validBudgets
			.filter((b) => b.pegToActual)
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
			unallocatedAmountInUSD: 0,
		};

		return {
			validBudgets,
			totalSpent,
			totalSpentInUSD,
			totalAllocated,
			totalAllocatedInUSD,
			displayAmount,
			displayAmountInUSD,
			remaining,
			remainingInUSD,
			isOverBudget,
			percentUsed,
			variableBudgets,
			fixedBudgets,
			stats,
		};
	}, [budgets]);
}

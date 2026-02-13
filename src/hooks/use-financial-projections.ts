export function useFinancialProjections(
	simulatedBudgets: Record<string, number>,
	monthlyIncome: number,
) {
	const totalProjectedSpend = Object.values(simulatedBudgets).reduce(
		(sum, val) => sum + val,
		0,
	);
	const projectedSurplus = monthlyIncome - totalProjectedSpend;
	const savingsRate = monthlyIncome > 0 ? (projectedSurplus / monthlyIncome) * 100 : 0;
	const annualProjectedSavings = projectedSurplus * 12;
	const isOverBudget = totalProjectedSpend > monthlyIncome;

	return {
		totalProjectedSpend,
		projectedSurplus,
		savingsRate,
		annualProjectedSavings,
		isOverBudget,
	};
}

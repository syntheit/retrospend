/**
 * Where a month's spending stands against its budget: what has actually been
 * used so far, and where the current pace ends up. The dashboard's budget card
 * shows the actual figures and only uses the pace for its warning color, so
 * a projection is never presented as an actual overage.
 */
export interface BudgetStanding {
	/** Spent as a percentage of the budget. */
	usedPct: number;
	/** Spent minus budget so far: positive is over budget, negative is left. */
	difference: number;
	/** Spend at the end of the period at the current daily pace, or null. */
	projectedSpend: number | null;
	/** Projected spend over the budget, as a ratio (1 = exactly on budget). */
	projectedRatio: number | null;
}

export function budgetStanding({
	totalBudget,
	totalSpent,
	currentDay,
	daysInMonth,
}: {
	totalBudget: number;
	totalSpent: number;
	currentDay: number;
	daysInMonth: number;
}): BudgetStanding | null {
	if (!(totalBudget > 0)) return null;
	const projectedSpend =
		currentDay > 0 ? (totalSpent / currentDay) * daysInMonth : null;
	return {
		usedPct: (totalSpent / totalBudget) * 100,
		difference: totalSpent - totalBudget,
		projectedSpend,
		projectedRatio: projectedSpend === null ? null : projectedSpend / totalBudget,
	};
}

/** Card color: red once over (or on pace to go over), amber when close. */
export function budgetStandingVariant(
	standing: BudgetStanding,
): "rose" | "amber" | "emerald" {
	const ratio = Math.max(
		standing.usedPct / 100,
		standing.projectedRatio ?? 0,
	);
	if (ratio > 1) return "rose";
	if (ratio > 0.9) return "amber";
	return "emerald";
}

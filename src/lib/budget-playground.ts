/**
 * What the budget playground's "Apply" writes back.
 *
 * The playground holds one simulated amount per category, seeded from each
 * budget's own amount. Applying must only touch what the user changed, and a
 * changed budget keeps its currency, type and rollover setting: the amount is
 * in the budget's own currency, and a pegged budget stays pegged. A category
 * without a budget gets a new FIXED budget in the home currency, which is the
 * currency the playground shows for it.
 */

export type PlaygroundBudgetType = "FIXED" | "PEG_TO_ACTUAL" | "PEG_TO_LAST_MONTH";

export interface PlaygroundBaseBudget {
	amount: number;
	currency: string;
	type: PlaygroundBudgetType;
	pegToActual: boolean;
	isRollover?: boolean;
	category?: { id: string } | null;
}

export interface PlaygroundApplyItem {
	categoryId: string;
	amount: number;
	currency: string;
	period: Date;
	type: PlaygroundBudgetType;
	pegToActual: boolean;
	isRollover: boolean;
}

/** The budget for each category, keyed by category id. */
export function budgetsByCategory<T extends PlaygroundBaseBudget>(
	budgets: readonly T[],
): Map<string, T> {
	const map = new Map<string, T>();
	for (const budget of budgets) {
		if (budget.category) map.set(budget.category.id, budget);
	}
	return map;
}

export function playgroundApplyPayload({
	baseBudgets,
	simulatedBudgets,
	homeCurrency,
	period,
}: {
	baseBudgets: readonly PlaygroundBaseBudget[];
	simulatedBudgets: Readonly<Record<string, number>>;
	homeCurrency: string;
	period: Date;
}): PlaygroundApplyItem[] {
	const existing = budgetsByCategory(baseBudgets);
	const payload: PlaygroundApplyItem[] = [];

	for (const [categoryId, amount] of Object.entries(simulatedBudgets)) {
		const base = existing.get(categoryId);
		if (base) {
			if (amount === base.amount) continue;
			payload.push({
				categoryId,
				amount,
				currency: base.currency,
				period,
				type: base.type,
				pegToActual: base.pegToActual,
				isRollover: base.isRollover ?? false,
			});
		} else if (amount > 0) {
			payload.push({
				categoryId,
				amount,
				currency: homeCurrency,
				period,
				type: "FIXED",
				pegToActual: false,
				isRollover: false,
			});
		}
	}

	return payload;
}

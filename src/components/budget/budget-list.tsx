"use client";

import { useMemo, useState } from "react";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { AddBudgetRow } from "./add-budget-row";
import { BudgetRow } from "./budget-row";

interface Budget {
	id: string;
	amount: number;
	actualSpend: number;
	effectiveAmount: number;
	pegToActual: boolean;
	category: {
		id: string;
		name: string;
		color: string;
	} | null;
}

interface Category {
	id: string;
	name: string;
	color: string;
}

interface BudgetListProps {
	budgets: Budget[];
	categories: Category[];
	globalLimit: number;
	selectedMonth: Date;
	isMobile: boolean;
	homeCurrency: string;
	budgetMode: "GLOBAL_LIMIT" | "SUM_OF_CATEGORIES";
}

interface BudgetSection {
	title: string;
	description: string;
	budgets: Budget[];
	totalAllocated: number;
	totalSpent: number;
}

export function BudgetList({
	budgets,
	categories,
	globalLimit,
	selectedMonth,
	isMobile,
	homeCurrency,
	budgetMode,
}: BudgetListProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const [newlyAddedBudgetId, setNewlyAddedBudgetId] = useState<string | null>(
		null,
	);
	const validBudgets = budgets.filter((budget) => budget.category !== null);

	const sections = useMemo(() => {
		// Separate budgets into sections
		const variableBudgets = validBudgets.filter(
			(budget) => !budget.pegToActual,
		);
		const fixedBudgets = validBudgets.filter((budget) => budget.pegToActual);

		// Sort by actual spend descending (biggest expenses first)
		const sortBySpendDesc = (a: Budget, b: Budget) =>
			b.actualSpend - a.actualSpend;

		const sections: BudgetSection[] = [
			{
				title: "Variable / Managed",
				description: "Categories you actively monitor and adjust",
				budgets: variableBudgets.sort(sortBySpendDesc),
				totalAllocated: variableBudgets.reduce((sum, b) => sum + b.amount, 0),
				totalSpent: variableBudgets.reduce((sum, b) => sum + b.actualSpend, 0),
			},
			{
				title: "Fixed / Pegged",
				description: "Categories that automatically match your actual spending",
				budgets: fixedBudgets.sort(sortBySpendDesc),
				totalAllocated: fixedBudgets.reduce(
					(sum, b) => sum + b.effectiveAmount,
					0,
				), // Use effectiveAmount for pegged
				totalSpent: fixedBudgets.reduce((sum, b) => sum + b.actualSpend, 0),
			},
		];

		// Only show sections that have budgets
		return sections.filter((section) => section.budgets.length > 0);
	}, [validBudgets]);

	const totalAllocated = validBudgets.reduce(
		(sum, budget) =>
			sum + (budget.pegToActual ? budget.effectiveAmount : budget.amount),
		0,
	);

	const _effectiveTotalLimit =
		budgetMode === "SUM_OF_CATEGORIES" ? totalAllocated : globalLimit;
	const unallocatedAmount =
		budgetMode === "GLOBAL_LIMIT"
			? Math.max(0, globalLimit - totalAllocated)
			: 0;

	// Find categories that don't have budgets
	const budgetedCategoryIds = new Set(
		validBudgets.map((budget) => budget.category?.id),
	);
	const unbudgetedCategories = categories.filter(
		(category) => !budgetedCategoryIds.has(category.id),
	);
	const hasVariableSection = sections.some(
		(section) => section.title === "Variable / Managed",
	);
	const shouldShowStandaloneAddRow =
		unbudgetedCategories.length > 0 && !hasVariableSection;

	const handleBudgetAdded = (budgetId: string) => {
		setNewlyAddedBudgetId(budgetId);
		// Clear the newly added state after a short delay
		setTimeout(() => setNewlyAddedBudgetId(null), 1000);
	};

	if (validBudgets.length === 0 && unbudgetedCategories.length === 0) {
		return (
			<div className="py-12 text-center">
				<p className="text-muted-foreground">No budgets set for this month.</p>
				<p className="mt-1 text-muted-foreground text-sm">
					Set a total monthly limit above and start allocating to categories.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{/* Budget Sections */}
			{sections.map((section) => (
				<div className="space-y-4" key={section.title}>
					{/* Section Header */}
					<div className="flex items-center justify-between">
						<div>
							<h3 className="font-semibold text-lg">{section.title}</h3>
							<p className="text-muted-foreground text-sm">
								{section.description}
							</p>
						</div>
						{!isMobile && (
							<div className="text-right">
								<div className="font-medium text-lg">
									{formatCurrency(section.totalSpent, homeCurrency)} /{" "}
									{formatCurrency(section.totalAllocated, homeCurrency)}
								</div>
								<div className="text-muted-foreground text-sm">
									{section.totalSpent > section.totalAllocated
										? "Over budget"
										: "On track"}
								</div>
							</div>
						)}
					</div>

					{/* Budget Rows */}
					<div className="space-y-2">
						{section.budgets.map((budget) => (
							<BudgetRow
								budget={budget}
								homeCurrency={homeCurrency}
								isMobile={isMobile}
								key={budget.id}
								selectedMonth={selectedMonth}
								startExpanded={budget.id === newlyAddedBudgetId}
							/>
						))}
						{/* Add Budget Row - only for Variable / Managed section */}
						{section.title === "Variable / Managed" &&
							unbudgetedCategories.length > 0 && (
								<AddBudgetRow
									unbudgetedCategories={unbudgetedCategories}
									selectedMonth={selectedMonth}
									isMobile={isMobile}
									onBudgetAdded={handleBudgetAdded}
								/>
							)}
					</div>
				</div>
			))}

			{/* First-time state: show add row even when no category budgets exist yet */}
			{shouldShowStandaloneAddRow && (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="font-semibold text-lg">Variable / Managed</h3>
							<p className="text-muted-foreground text-sm">
								Categories you actively monitor and adjust
							</p>
						</div>
					</div>

					<div className="space-y-2">
						<AddBudgetRow
							unbudgetedCategories={unbudgetedCategories}
							selectedMonth={selectedMonth}
							isMobile={isMobile}
							onBudgetAdded={handleBudgetAdded}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

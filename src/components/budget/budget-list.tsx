import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { useBudgetCalculations } from "~/hooks/use-budget-calculations";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { Budget, Category } from "~/types/budget-types";
import { AddBudgetRow } from "./add-budget-row";
import { BudgetRow } from "./budget-row";

interface BudgetListProps {
	budgets: Budget[];
	categories: Category[];
	selectedMonth: Date;
	isMobile: boolean;
	homeCurrency: string;
	hasPreviousBudgets: boolean;
	isCopying: boolean;
	onCopyFromLastMonth: () => void;
}

export function BudgetList({
	budgets,
	categories,
	selectedMonth,
	isMobile,
	homeCurrency,
	hasPreviousBudgets,
	isCopying,
	onCopyFromLastMonth,
}: BudgetListProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const [newlyAddedBudgetId, setNewlyAddedBudgetId] = useState<string | null>(
		null,
	);

	const { validBudgets, variableBudgets, fixedBudgets } = useBudgetCalculations(
		{
			budgets,
		},
	);

	const sections = useMemo(() => {
		const result = [];
		if (variableBudgets.length > 0) {
			result.push({
				title: "Variable / Managed",
				description: "Categories you actively monitor and adjust",
				budgets: variableBudgets,
				totalAllocated: variableBudgets.reduce((sum, b) => sum + b.amount, 0),
				totalSpent: variableBudgets.reduce((sum, b) => sum + b.actualSpend, 0),
			});
		}
		if (fixedBudgets.length > 0) {
			result.push({
				title: "Fixed / Pegged",
				description: "Categories that automatically match your actual spending",
				budgets: fixedBudgets,
				totalAllocated: fixedBudgets.reduce(
					(sum, b) => sum + b.effectiveAmount,
					0,
				),
				totalSpent: fixedBudgets.reduce((sum, b) => sum + b.actualSpend, 0),
			});
		}
		return result;
	}, [variableBudgets, fixedBudgets]);

	const monthLabel = selectedMonth.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	});

	// Find categories that don't have budgets
	const budgetedCategoryIds = new Set(validBudgets.map((b) => b.category?.id));
	const unbudgetedCategories = categories.filter(
		(c) => !budgetedCategoryIds.has(c.id),
	);

	const hasVariableSection = variableBudgets.length > 0;
	const shouldShowStandaloneAddRow =
		unbudgetedCategories.length > 0 && !hasVariableSection;

	const handleBudgetAdded = (budgetId: string) => {
		setNewlyAddedBudgetId(budgetId);
		setTimeout(() => setNewlyAddedBudgetId(null), 1000);
	};

	if (validBudgets.length === 0 && unbudgetedCategories.length === 0) {
		return (
			<div className="space-y-4 py-12 text-center">
				<div>
					<p className="text-muted-foreground">
						No budgets set for this month.
					</p>
					<p className="mt-1 text-muted-foreground text-sm">
						Start allocating to categories to set your budget.
					</p>
				</div>
				{hasPreviousBudgets && (
					<Button
						disabled={isCopying}
						onClick={onCopyFromLastMonth}
						size="sm"
						variant="outline"
					>
						{isCopying ? "Copying..." : "Copy from last month"}
					</Button>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{validBudgets.length === 0 && hasPreviousBudgets && (
				<div className="rounded-lg border bg-muted/50 p-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="text-left">
							<p className="font-medium text-foreground text-sm">
								Bring forward last month&apos;s plan
							</p>
							<p className="text-muted-foreground text-sm">
								Copy your most recent budgets into {monthLabel} and adjust as
								needed.
							</p>
						</div>
						<div className="flex gap-2">
							<Button
								disabled={isCopying}
								onClick={onCopyFromLastMonth}
								size="sm"
								variant="outline"
							>
								{isCopying ? "Copying..." : "Copy last month"}
							</Button>
						</div>
					</div>
				</div>
			)}

			{sections.map((section) => (
				<div className="space-y-4" key={section.title}>
					<div className="flex items-center justify-between">
						<div>
							<h3 className="font-semibold text-lg tracking-tight">{section.title}</h3>
							<p className="text-muted-foreground text-sm">
								{section.description}
							</p>
						</div>
						{!isMobile && (
							<div className="text-right">
								<div className="font-medium text-lg tabular-nums tracking-tighter">
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
						{section.title === "Variable / Managed" &&
							unbudgetedCategories.length > 0 && (
								<AddBudgetRow
									homeCurrency={homeCurrency}
									isMobile={isMobile}
									onBudgetAdded={handleBudgetAdded}
									selectedMonth={selectedMonth}
									unbudgetedCategories={unbudgetedCategories}
								/>
							)}
					</div>
				</div>
			))}

			{shouldShowStandaloneAddRow && (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="font-semibold text-lg tracking-tight">Variable / Managed</h3>
							<p className="text-muted-foreground text-sm">
								Categories you actively monitor and adjust
							</p>
						</div>
					</div>

					<div className="space-y-2">
						<AddBudgetRow
							homeCurrency={homeCurrency}
							isMobile={isMobile}
							onBudgetAdded={handleBudgetAdded}
							selectedMonth={selectedMonth}
							unbudgetedCategories={unbudgetedCategories}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

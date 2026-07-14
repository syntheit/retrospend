import { useTranslations } from "next-intl";
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
	const t = useTranslations("budget");
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
				title: t("variableManaged"),
				description: t("variableManagedDescription"),
				budgets: variableBudgets,
				totalAllocated: variableBudgets.reduce((sum, b) => sum + b.amount, 0),
				totalSpent: variableBudgets.reduce((sum, b) => sum + b.actualSpend, 0),
			});
		}
		if (fixedBudgets.length > 0) {
			result.push({
				title: t("fixedPegged"),
				description: t("fixedPeggedDescription"),
				budgets: fixedBudgets,
				totalAllocated: fixedBudgets.reduce(
					(sum, b) => sum + b.effectiveAmount,
					0,
				),
				totalSpent: fixedBudgets.reduce((sum, b) => sum + b.actualSpend, 0),
			});
		}
		return result;
	}, [variableBudgets, fixedBudgets, t]);

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
						{t("noBudgetsSet")}
					</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{t("startAllocating")}
					</p>
				</div>
				{hasPreviousBudgets && (
					<Button
						disabled={isCopying}
						onClick={onCopyFromLastMonth}
						size="sm"
						variant="outline"
					>
						{isCopying ? t("copying") : t("copyFromLastMonth")}
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
								{t("bringForwardPlan")}
							</p>
							<p className="text-muted-foreground text-sm">
								{t("copyIntoMonth", { month: monthLabel })}
							</p>
						</div>
						<div className="flex gap-2">
							<Button
								disabled={isCopying}
								onClick={onCopyFromLastMonth}
								size="sm"
								variant="outline"
							>
								{isCopying ? t("copying") : t("copyLastMonth")}
							</Button>
						</div>
					</div>
				</div>
			)}

			{sections.map((section) => (
				<div className="space-y-4" key={section.title}>
					<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h3 className="font-semibold text-lg tracking-tight">
								{section.title}
							</h3>
							<p className="text-muted-foreground text-sm">
								{section.description}
							</p>
						</div>
						<div className="sm:text-right">
							<div className="font-medium text-base tabular-nums tracking-tighter sm:text-lg">
								{formatCurrency(section.totalSpent, homeCurrency)} /{" "}
								{formatCurrency(section.totalAllocated, homeCurrency)}
							</div>
							<div className="text-muted-foreground text-xs sm:text-sm">
								{section.totalSpent > section.totalAllocated
									? t("overBudget")
									: t("onTrack")}
							</div>
						</div>
					</div>

					<div className="space-y-2">
						{section.budgets.map((budget) => (
							<BudgetRow
								budget={budget}
								homeCurrency={homeCurrency}
								key={budget.id}
								selectedMonth={selectedMonth}
								startExpanded={budget.id === newlyAddedBudgetId}
							/>
						))}
						{section.title === t("variableManaged") &&
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
					<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h3 className="font-semibold text-lg tracking-tight">
								{t("variableManaged")}
							</h3>
							<p className="text-muted-foreground text-sm">
								{t("variableManagedDescription")}
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

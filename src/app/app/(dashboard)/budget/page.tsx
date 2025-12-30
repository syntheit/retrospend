"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { BudgetHeader } from "~/components/budget/budget-header";
import { BudgetList } from "~/components/budget/budget-list";
import { PartitionBar } from "~/components/budget/partition-bar";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";

export default function BudgetPage() {
	const { formatCurrency } = useCurrencyFormatter();
	const [selectedMonth, setSelectedMonth] = useState(new Date());
	const isMobile = useIsMobile();

	// Get budgets for the selected month
	const { data: budgets } = api.budget.getBudgets.useQuery({
		month: selectedMonth,
	});

	// Get all categories
	const { data: categories } = api.user.listCategories.useQuery();

	// Get global budget
	const { data: globalBudget } = api.budget.getGlobalBudget.useQuery({
		month: selectedMonth,
	});

	// Get total spending for this month
	const { data: totalSpending } = api.expense.getTotalSpending.useQuery({
		month: selectedMonth,
	});

	// Get user settings for currency and budget mode
	const { data: settings } = api.user.getSettings.useQuery();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const budgetMode = settings?.budgetMode ?? "GLOBAL_LIMIT";

	const globalLimit = globalBudget?.amount ?? 0;

	const navigateMonth = (direction: "prev" | "next") => {
		const newDate = new Date(selectedMonth);
		if (direction === "prev") {
			newDate.setMonth(newDate.getMonth() - 1);
		} else {
			newDate.setMonth(newDate.getMonth() + 1);
		}
		setSelectedMonth(newDate);
	};

	return (
		<>
			<SiteHeader
				actions={
					<div className="flex items-center gap-2">
						<Button
							onClick={() => navigateMonth("prev")}
							size="icon"
							variant="outline"
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<Button
							onClick={() => navigateMonth("next")}
							size="icon"
							variant="outline"
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				}
				title="Monthly Budget"
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-8">
					{/* Unified Budget Header */}
					<BudgetHeader
						selectedMonth={selectedMonth}
						budgetMode={budgetMode}
						homeCurrency={homeCurrency}
						budgets={budgets ?? []}
					/>

					{/* Partition Bar */}
					{budgets && budgets.length > 0 && (
						<div className="space-y-4">
							<div>
								<h2 className="font-semibold text-lg">Budget Overview</h2>
								<p className="text-muted-foreground text-sm">
									Visual breakdown of your monthly budget allocation
								</p>
								{(() => {
									const totalAllocated =
										budgets?.reduce(
											(sum, budget) =>
												sum +
												Number(
													budget.pegToActual
														? budget.effectiveAmount
														: budget.amount,
												),
											0,
										) || 0;
									const effectiveLimit =
										budgetMode === "SUM_OF_CATEGORIES"
											? totalAllocated
											: globalLimit;
									return (
										effectiveLimit > 0 && (
											<p className="text-muted-foreground text-sm">
												{formatCurrency(
													totalSpending?.total || 0,
													homeCurrency,
												)}{" "}
												spent of {formatCurrency(effectiveLimit, homeCurrency)}{" "}
												{budgetMode === "SUM_OF_CATEGORIES"
													? "total budget"
													: "monthly limit"}
											</p>
										)
									);
								})()}
							</div>
							<PartitionBar
								budgetMode={budgetMode}
								categoryBudgets={budgets
									.filter((budget) => budget.category)
									.map((budget) => ({
										id: budget.category!.id,
										name: budget.category!.name,
										color: budget.category!.color,
										allocatedAmount: Number(
											budget.pegToActual
												? budget.effectiveAmount
												: budget.amount,
										),
										actualSpend: Number(budget.actualSpend),
										pegToActual: budget.pegToActual ?? false,
									}))}
								globalLimit={globalLimit}
								isMobile={isMobile}
							/>
						</div>
					)}

					{/* Budget List */}
					{(budgets && budgets.length > 0) ||
					(categories && categories.length > 0) ? (
						<div className="space-y-4">
							<div>
								<h2 className="font-semibold text-lg">Category Budgets</h2>
								<p className="text-muted-foreground text-sm">
									Manage your spending limits by category
								</p>
							</div>
							<BudgetList
								budgetMode={budgetMode}
								budgets={budgets ?? []}
								categories={categories ?? []}
								globalLimit={globalLimit}
								homeCurrency={homeCurrency}
								isMobile={isMobile}
								selectedMonth={selectedMonth}
							/>
						</div>
					) : null}
				</div>
			</PageContent>
		</>
	);
}

"use client";

import { useMemo, useState } from "react";
import { BudgetHeader } from "~/components/budget/budget-header";
import { BudgetList } from "~/components/budget/budget-list";
import { PartitionBar } from "~/components/budget/partition-bar";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { useCurrency } from "~/hooks/use-currency";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";
import { handleError } from "~/lib/handle-error";

export default function BudgetPage() {
	const [selectedMonth, setSelectedMonth] = useState(new Date());
	const isMobile = useIsMobile();
	const utils = api.useUtils();

	const { data: budgets } = api.budget.getBudgets.useQuery({
		month: selectedMonth,
	});

	const { data: categories } = api.categories.getAll.useQuery();

	const { data: globalBudget } = api.budget.getGlobalBudget.useQuery({
		month: selectedMonth,
	});

	const { data: hasPreviousBudgets } =
		api.budget.hasBudgetsBeforeMonth.useQuery({
			month: selectedMonth,
		});

	const { homeCurrency, usdToHomeRate: usdToHomeCurrencyRate } = useCurrency();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const budgetMode = settings?.budgetMode ?? "GLOBAL_LIMIT";

	const globalLimit = globalBudget?.amount ?? 0;
	const globalLimitInUSD = globalBudget?.amountInUSD ?? 0;

	const copyFromLastMonth = api.budget.copyFromLastMonth.useMutation();

	const categoryBudgets = useMemo(() => {
		if (!budgets) return [];

		return budgets
			.filter((budget) => budget.category)
			.map((budget) => {
				// biome-ignore lint/style/noNonNullAssertion: Guaranteed by filter
				const category = budget.category!;
				return {
					id: category.id,
					name: category.name,
					color: category.color,
					allocatedAmount: Number(
						budget.pegToActual ? budget.effectiveAmount : budget.amount,
					),
					actualSpend: Number(budget.actualSpend),
					pegToActual: budget.pegToActual ?? false,
				};
			});
	}, [budgets]);

	const navigateMonth = (direction: "prev" | "next") => {
		const newDate = new Date(selectedMonth);
		if (direction === "prev") {
			newDate.setMonth(newDate.getMonth() - 1);
		} else {
			newDate.setMonth(newDate.getMonth() + 1);
		}
		setSelectedMonth(newDate);
	};

	const handleCopyFromLastMonth = async () => {
		try {
			await copyFromLastMonth.mutateAsync({
				targetMonth: selectedMonth,
			});
			await Promise.all([
				utils.budget.getBudgets.invalidate({ month: selectedMonth }),
				utils.budget.hasBudgetsBeforeMonth.invalidate({
					month: selectedMonth,
				}),
			]);
		} catch (error) {
			handleError(error, "Failed to copy budgets");
		}
	};

	const hasContent =
		(budgets && budgets.length > 0) || (categories && categories.length > 0);

	return (
		<>
			<SiteHeader title="Monthly Budget" />
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-6">
					<BudgetHeader
						budgetMode={budgetMode}
						budgets={budgets ?? []}
						hasPreviousBudgets={hasPreviousBudgets}
						homeCurrency={homeCurrency}
						onNavigateMonth={navigateMonth}
						selectedMonth={selectedMonth}
						usdToHomeCurrencyRate={usdToHomeCurrencyRate ?? 1}
					/>

					{categoryBudgets.length > 0 && (
						<div className="space-y-4 pt-2">
							<PartitionBar
								budgetMode={budgetMode}
								categoryBudgets={categoryBudgets}
								globalLimit={globalLimit}
								isMobile={isMobile}
							/>
						</div>
					)}

					{hasContent && (
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
								globalLimitInUSD={globalLimitInUSD}
								hasPreviousBudgets={hasPreviousBudgets ?? false}
								homeCurrency={homeCurrency}
								isCopying={copyFromLastMonth.isPending}
								isMobile={isMobile}
								onCopyFromLastMonth={handleCopyFromLastMonth}
								selectedMonth={selectedMonth}
							/>
						</div>
					)}
				</div>
			</PageContent>
		</>
	);
}

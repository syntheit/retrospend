"use client";

import { useMemo, useState } from "react";
import { BudgetHeader } from "~/components/budget/budget-header";
import { BudgetList } from "~/components/budget/budget-list";
import { PartitionBar } from "~/components/budget/partition-bar";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { useCurrency } from "~/hooks/use-currency";
import { useIsMobile } from "~/hooks/use-mobile";
import { handleError } from "~/lib/handle-error";
import { api } from "~/trpc/react";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Button } from "~/components/ui/button";

export default function BudgetPage() {
	const [selectedMonth, setSelectedMonth] = useState(new Date());
	const isMobile = useIsMobile();
	const utils = api.useUtils();

	const { data: budgets } = api.budget.getBudgets.useQuery({
		month: selectedMonth,
	});

	const { data: categories } = api.categories.getAll.useQuery();

	const { data: hasPreviousBudgets } =
		api.budget.hasBudgetsBeforeMonth.useQuery({
			month: selectedMonth,
		});

	const { homeCurrency, usdToHomeRate: usdToHomeCurrencyRate } = useCurrency();

	const copyFromLastMonth = api.budget.copyFromLastMonth.useMutation();

	const categoryBudgets = useMemo(() => {
		if (!budgets) return [];

		return budgets
			.map((budget) => {
				const category = budget.category;
				if (!category) return null;

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
			})
			.filter((b): b is NonNullable<typeof b> => b !== null);
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
			<SiteHeader 
				title="Monthly Budget" 
				actions={
					<Link href="/app/budget/playground">
						<Button size="sm" variant="outline" className="h-8 gap-2 border-dashed border-indigo-400/50 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300">
							<FlaskConical className="h-3.5 w-3.5" />
							{!isMobile && "Budget Playground"}
						</Button>
					</Link>
				}
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-6">
					<BudgetHeader
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
								categoryBudgets={categoryBudgets}
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
								budgets={budgets ?? []}
								categories={categories ?? []}
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

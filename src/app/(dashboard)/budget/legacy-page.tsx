"use client";

import { useTranslations } from "next-intl";
import { BudgetHeader } from "~/components/budget/budget-header";
import { BudgetList } from "~/components/budget/budget-list";
import { PartitionBar } from "~/components/budget/partition-bar";
import { MonthStepper } from "~/components/date/MonthStepper";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Skeleton } from "~/components/ui/skeleton";
import { useBudgetController } from "~/hooks/use-budget-controller";

export default function LegacyBudgetPage() {
	const t = useTranslations("budget");
	const {
		selectedMonth,
		setSelectedMonth,
		isLoading,
		isMobile,
		budgets,
		categories,
		categoryBudgets,
		hasPreviousBudgets,
		hasContent,
		homeCurrency,
		serverTime,
		budgetMaxDate,
		budgetMinDate,
		handleCopyFromLastMonth,
		isCopying,
	} = useBudgetController();

	if (isLoading) {
		return (
			<>
				<SiteHeader
					actions={
						<MonthStepper
							maxDate={budgetMaxDate}
							onChange={setSelectedMonth}
							value={selectedMonth}
						/>
					}
					title={t("title")}
				/>
				<PageContent>
					<div className="mx-auto w-full max-w-6xl space-y-6">
						<Skeleton className="h-[180px] w-full rounded-xl" />
						<Skeleton className="h-12 w-full rounded-lg" />
						<div className="space-y-4">
							<Skeleton className="h-6 w-48" />
							<div className="space-y-2">
								<Skeleton className="h-16 w-full rounded-lg" />
								<Skeleton className="h-16 w-full rounded-lg" />
								<Skeleton className="h-16 w-full rounded-lg" />
							</div>
						</div>
					</div>
				</PageContent>
			</>
		);
	}

	return (
		<>
			<SiteHeader
				actions={
					<MonthStepper
						maxDate={budgetMaxDate}
						minDate={budgetMinDate}
						onChange={setSelectedMonth}
						value={selectedMonth}
					/>
				}
				title={t("title")}
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-6">
					<BudgetHeader
						budgets={budgets}
						homeCurrency={homeCurrency}
						selectedMonth={selectedMonth}
						serverTime={serverTime}
					/>

					{categoryBudgets.length > 0 && (
						<div className="space-y-4 pt-2">
							<PartitionBar
								categoryBudgets={categoryBudgets}
								homeCurrency={homeCurrency}
							/>
						</div>
					)}

					{hasContent && (
						<div className="space-y-4">
							<div>
								<h2 className="text-lg font-semibold">
									{t("categoryBudgets")}
								</h2>
								<p className="text-muted-foreground text-sm">
									{t("categoryBudgetsDescription")}
								</p>
							</div>
							<BudgetList
								budgets={budgets}
								categories={categories}
								hasPreviousBudgets={hasPreviousBudgets}
								homeCurrency={homeCurrency}
								isCopying={isCopying}
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

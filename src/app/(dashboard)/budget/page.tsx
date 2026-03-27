"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { BudgetHeader } from "~/components/budget/budget-header";
import { BudgetList } from "~/components/budget/budget-list";
import { PartitionBar } from "~/components/budget/partition-bar";
import { MonthStepper } from "~/components/date/MonthStepper";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useBudgetController } from "~/hooks/use-budget-controller";

export default function BudgetPage() {
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
		usdToHomeRate,
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
						<>
							<MonthStepper
								maxDate={budgetMaxDate}
								onChange={setSelectedMonth}
								value={selectedMonth}
							/>
							<Link href="/budget/playground">
								<Button size="sm" variant="outline">
									<FlaskConical className="h-3.5 w-3.5" />
									<span className="hidden sm:inline">Budget Playground</span>
								</Button>
							</Link>
						</>
					}
					title="Budget"
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
					<>
						<MonthStepper
							maxDate={budgetMaxDate}
							minDate={budgetMinDate}
							onChange={setSelectedMonth}
							value={selectedMonth}
						/>
						<Link href="/budget/playground">
							<Button size="sm" variant="outline">
								<FlaskConical className="h-3.5 w-3.5" />
								<span className="hidden sm:inline">Budget Playground</span>
							</Button>
						</Link>
					</>
				}
				title="Budget"
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-6">
					<BudgetHeader
						budgets={budgets}
						homeCurrency={homeCurrency}
						selectedMonth={selectedMonth}
						serverTime={serverTime}
						usdToHomeCurrencyRate={usdToHomeRate}
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
								<h2 className="font-semibold text-lg">Category Budgets</h2>
								<p className="text-muted-foreground text-sm">
									Manage your spending limits by category
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

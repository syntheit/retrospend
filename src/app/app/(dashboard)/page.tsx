"use client";

import Link from "next/link";
import { MonthStepper } from "~/components/date/MonthStepper";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useOverviewController } from "~/hooks/use-overview-controller";
import { CategoryDonut } from "./_components/category-donut";
import { FavoritesPanel } from "./_components/favorites-panel";
import { RecentExpenses } from "./_components/recent-expenses";
import { StatsCards } from "./_components/stats-cards";
import { TrendChart } from "./_components/trend-chart";


export default function Page() {
	const { state, data, isLoading, actions } = useOverviewController();
	const { formatCurrency } = useCurrencyFormatter();

	const renderOnboarding = () => (
		<Card className="border-dashed">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					Welcome to Retrospend
				</CardTitle>
				<CardDescription>
					Add your first expense to replace the sample data and unlock real
					insights.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-2">
				<Button onClick={actions.handleCreateExpense}>Add expense</Button>
				<Button asChild variant="outline">
					<Link href="/app/table">Go to table view</Link>
				</Button>
				<span className="text-muted-foreground text-xs">
					Charts will switch from sample data as soon as you add an expense.
				</span>
			</CardContent>
		</Card>
	);

	return (
		<>
			<SiteHeader
				actions={
					<MonthStepper
						minDate={data.earliestBudgetMonth ?? undefined}
						onChange={actions.setSelectedMonth}
						value={state.selectedMonth}
					/>
				}
				title="Overview"
			/>
			<PageContent>
				<div className="space-y-4 lg:space-y-6">
					{state.isUsingMockExpenses && renderOnboarding()}
					<StatsCards
						categoryBreakdown={data.categoryBreakdown}
						changeVsLastMonth={data.summaryStats?.changeVsLastMonth ?? null}
						dailyAverage={data.summaryStats?.dailyAverage ?? 0}
						expensesLoading={isLoading.stats}
						homeCurrency={data.homeCurrency}
						overviewStats={data.overviewStats}
						projectedSpend={data.summaryStats?.projectedSpend ?? 0}
						totalThisMonth={data.summaryStats?.totalThisMonth ?? 0}
					/>

					<section className="grid gap-4 lg:grid-cols-2">
						<CategoryDonut
							activeSlice={state.activeSlice}
							activeSliceIndex={state.activeSliceIndex}
							categoryBreakdown={data.categoryBreakdown}
							categoryClickBehavior={data.categoryClickBehavior}
							expensesLoading={isLoading.categories}
							formatMoney={(value: number) =>
								formatCurrency(value, data.homeCurrency)
							}
							handleCategoryClick={actions.handleCategoryClick}
							handleSliceEnter={(_, index) => actions.setActiveSliceIndex(index)}
							handleSliceLeave={() => actions.setActiveSliceIndex(null)}
							hiddenCategories={state.hiddenCategories}
							isUsingMockExpenses={state.isUsingMockExpenses}
							pieChartConfig={data.pieChartConfig}
							visibleCategoryBreakdown={data.visibleCategoryBreakdown}
							visibleTotal={data.visibleTotal}
						/>

						<RecentExpenses
							expensesLoading={isLoading.expenses}
							formatCurrency={formatCurrency}
							homeCurrency={data.homeCurrency}
							liveRateToBaseCurrency={data.liveRateToBaseCurrency}
							recentExpenses={data.recentExpenses}
						/>
					</section>

					<section className="grid gap-4 lg:grid-cols-3">
						<TrendChart
							areaChartConfig={data.areaChartConfig}
							dailyTrend={data.dailyTrend}
							expensesLoading={isLoading.trend}
							now={state.now}
						/>

						<FavoritesPanel
							favoriteRates={data.favoriteRates}
							favoritesLoading={isLoading.favorites}
							isUsingMockFavorites={state.isUsingMockFavorites}
						/>
					</section>
				</div>
			</PageContent>
		</>
	);
}

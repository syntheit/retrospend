"use client";

import {
	BarChart3,
	Globe,
	Receipt,
	Smartphone,
	Target,
	TrendingUp,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { MonthStepper } from "~/components/date/MonthStepper";
import { useExpenseModal } from "~/components/expense-modal-provider";
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
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useOverviewController } from "~/hooks/use-overview-controller";
import { api } from "~/trpc/react";
import { FavoritesPanel } from "../_components/favorites-panel";

const BudgetPacingChart = dynamic(
	() => import("../_components/budget-pacing-chart").then((m) => m.BudgetPacingChart),
	{ ssr: false, loading: () => <Skeleton className="h-[300px] w-full rounded-xl" /> },
);
const CategoryDonut = dynamic(
	() => import("../_components/category-donut").then((m) => m.CategoryDonut),
	{ ssr: false, loading: () => <Skeleton className="h-[300px] w-full rounded-xl" /> },
);
import {
	RecentExpenses,
	type ActivityItem,
} from "../_components/recent-expenses";
import { StatsCards } from "../_components/stats-cards";

export default function Page() {
	const t = useTranslations("dashboard");
	const { state, data, isLoading, actions } = useOverviewController();
	const { formatCurrency } = useCurrencyFormatter();
	const { openExpense, openSharedExpense } = useExpenseModal();
	const router = useRouter();
	const utils = api.useUtils();

	const [pendingDeleteItem, setPendingDeleteItem] =
		useState<ActivityItem | null>(null);

	const deleteMutation = api.expense.deleteExpense.useMutation({
		onSuccess: async () => {
			toast.success(t("expenseDeleted"));
			await utils.dashboard.getRecentActivity.invalidate();
			setPendingDeleteItem(null);
		},
		onError: () => {
			toast.error(t("expenseDeleteFailed"));
		},
	});

	const { data: claimedShadowCount = 0 } = api.people.claimedShadowCount.useQuery(
		undefined,
		{ enabled: state.isUsingMockExpenses },
	);

	const handleActivityClick = useCallback(
		(item: ActivityItem) => {
			if (item.type === "personal") {
				openExpense(item.id);
			} else if (item.type === "shared") {
				if (item.sharedContext?.projectId) {
					router.push(`/projects/${item.sharedContext.projectId}`);
				} else if (item.sharedContext?.transactionId) {
					openSharedExpense(item.sharedContext.transactionId);
				}
			} else if (item.type === "settlement") {
				router.push("/people");
			}
		},
		[openExpense, openSharedExpense, router],
	);

	const renderOnboarding = () => (
		<Card className="border-dashed">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					{t("welcomeTitle")}
				</CardTitle>
				<CardDescription>{t("welcomeDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-2">
				<Button onClick={actions.handleCreateExpense}>{t("addExpense")}</Button>
				<Button asChild variant="outline">
					<Link href="/transactions">{t("goToTransactions")}</Link>
				</Button>
				<span className="text-muted-foreground text-xs">
					{t("chartsSwitchHint")}
				</span>
			</CardContent>
		</Card>
	);

	const renderUpgradeWelcome = () => (
		<Card className="border-dashed">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					{t("welcomeTitle")}
				</CardTitle>
				<CardDescription>{t("upgradeDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground text-sm">{t("upgradeExploreText")}</p>
				<ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-muted-foreground text-sm sm:grid-cols-2">
					<li className="flex items-center gap-2">
						<Smartphone className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeAccessFromDevice")}
					</li>
					<li className="flex items-center gap-2">
						<BarChart3 className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeSpendingTracking")}
					</li>
					<li className="flex items-center gap-2">
						<Target className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeBudgets")}
					</li>
					<li className="flex items-center gap-2">
						<TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeWealth")}
					</li>
					<li className="flex items-center gap-2">
						<Globe className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeMultiCurrency")}
					</li>
					<li className="flex items-center gap-2">
						<Receipt className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeBankImports")}
					</li>
				</ul>
				<div className="flex flex-wrap items-center gap-2 pt-1">
					<Button onClick={actions.handleCreateExpense}>{t("addFirstExpense")}</Button>
					<Button asChild variant="outline">
						<Link href="/transactions">{t("goToTransactions")}</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	);

	return (
		<>
			<SiteHeader
				actions={
					<MonthStepper
						maxDate={state.serverTime}
						minDate={data.earliestBudgetMonth ?? undefined}
						onChange={actions.setSelectedMonth}
						value={state.selectedMonth}
					/>
				}
				title={t("title")}
			/>
			<PageContent fill>
				<div className="flex flex-col gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
					{state.isUsingMockExpenses && (
						<div className="flex-shrink-0">
							{claimedShadowCount > 0 ? renderUpgradeWelcome() : renderOnboarding()}
						</div>
					)}
					<div className="flex-shrink-0">
						<StatsCards
							budgetPacing={data.budgetPacing}
							categoryBreakdown={data.categoryBreakdown}
							changeVsLastMonth={data.summaryStats?.changeVsLastMonth ?? null}
							dailyAverage={data.summaryStats?.dailyAverage ?? 0}
							expensesLoading={isLoading.stats}
							homeCurrency={data.homeCurrency}
							overviewStats={data.overviewStats}
							projectedSpend={data.summaryStats?.projectedSpend ?? 0}
							totalThisMonth={data.summaryStats?.totalThisMonth ?? 0}
						/>
					</div>

					<div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:flex-1 lg:min-h-0 lg:grid-rows-1">
						{/* Main Content Column */}
						<div className="flex flex-col gap-6 lg:col-span-7">
							<div className="h-[250px] sm:h-[350px] flex-shrink-0">
								<BudgetPacingChart
									chartConfig={data.areaChartConfig}
									currentDay={data.budgetPacing.currentDay}
									dailyTrend={data.dailyTrend}
									daysInMonth={data.budgetPacing.daysInMonth}
									expensesLoading={isLoading.trend}
									homeCurrency={data.homeCurrency}
									variableBudget={data.budgetPacing.variableBudget}
									variableSpent={data.budgetPacing.variableSpent}
								/>
							</div>

							<div className="flex-1 min-h-0">
								<RecentExpenses
									activityLoading={isLoading.activity}
									formatCurrency={formatCurrency}
									homeCurrency={data.homeCurrency}
									liveRateToBaseCurrency={data.liveRateToBaseCurrency}
									onDeleteItem={setPendingDeleteItem}
									onItemClick={handleActivityClick}
									recentActivity={data.recentActivity}
								/>
							</div>
						</div>

						{/* Sidebar Column */}
						<div className="flex flex-col gap-6 lg:col-span-5">
							<div className="flex-shrink-0">
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
									handleSliceEnter={(_, index) =>
										actions.setActiveSliceIndex(index)
									}
									handleSliceLeave={() => actions.setActiveSliceIndex(null)}
									hiddenCategories={state.hiddenCategories}
									isUsingMockExpenses={state.isUsingMockExpenses}
									pieChartConfig={data.pieChartConfig}
									visibleCategoryBreakdown={data.visibleCategoryBreakdown}
									visibleTotal={data.visibleTotal}
								/>
							</div>


							<div className="flex-1 min-h-0">
								<FavoritesPanel
									favoriteRates={data.favoriteRates}
									favoritesLoading={isLoading.favorites}
								/>
							</div>
						</div>
					</div>
				</div>
			</PageContent>
		<ConfirmationDialog
			confirmLabel={t("deleteExpenseConfirm")}
			description={t("deleteExpenseDescription")}
			isLoading={deleteMutation.isPending}
			onConfirm={() => {
				if (pendingDeleteItem) {
					deleteMutation.mutate({ id: pendingDeleteItem.id });
				}
			}}
			onOpenChange={(open) => { if (!open) setPendingDeleteItem(null); }}
			open={pendingDeleteItem !== null}
			title={t("deleteExpenseTitle")}
			variant="destructive"
		/>
		</>
	);
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import type { ChartConfig } from "~/components/ui/chart";
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { resolveCategoryColorValue } from "~/lib/category-colors";
import { type NormalizedExpense, normalizeExpensesFromApi } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { CategoryDonut } from "./_components/category-donut";
import type { CategorySegment } from "./_components/category-donut-legend";
import { FavoritesPanel } from "./_components/favorites-panel";
import { RecentExpenses } from "./_components/recent-expenses";
import { StatsCards } from "./_components/stats-cards";
import { TrendChart } from "./_components/trend-chart";

type FavoriteRate =
	RouterOutputs["settings"]["getFavoriteExchangeRates"][number];

type NormalizedFavorite = {
	id: string;
	currency: string;
	type: string;
	rate: number;
	date: Date;
};

const chartPalette = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

export default function Page() {
	const {
		data: expensesData,
		isLoading: expensesLoading,
		isFetched: expensesFetched,
	} = api.expense.listFinalized.useQuery();
	const {
		data: favoritesData,
		isLoading: favoritesLoading,
		isFetched: favoritesFetched,
	} = api.settings.getFavoriteExchangeRates.useQuery();
	const { homeCurrency, usdToHomeRate: liveRateToBaseCurrency } = useCurrency();
	const { formatCurrency } = useCurrencyFormatter();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const [selectedMonth, setSelectedMonth] = useState<Date>(() => new Date());

	const { data: overviewStats } = api.dashboard.getOverviewStats.useQuery({
		month: selectedMonth,
		homeCurrency,
	});
	const { data: earliestBudgetMonth } =
		api.budget.getEarliestBudgetMonth.useQuery();
	const router = useRouter();
	const { openNewExpense } = useExpenseModal();

	const categoryClickBehavior = settings?.categoryClickBehavior ?? "toggle";

	const expenses: NormalizedExpense[] = useMemo(
		() => normalizeExpensesFromApi(expensesData ?? []),
		[expensesData],
	);

	const favoriteRates: NormalizedFavorite[] = useMemo(() => {
		if (!favoritesData) return [];
		return favoritesData.map((fav: FavoriteRate) => ({
			id: fav.id,
			currency: fav.rate.currency,
			type: fav.rate.type,
			rate: Number(fav.rate.rate),
			date: new Date(fav.rate.date),
		}));
	}, [favoritesData]);

	const now = new Date();

	const { data: summaryStats, isLoading: statsLoading } =
		api.stats.getSummary.useQuery({
			month: selectedMonth,
			homeCurrency,
		});

	const { data: categoryData, isLoading: categoriesLoading } =
		api.stats.getCategoryBreakdown.useQuery({
			month: selectedMonth,
			homeCurrency,
		});

	const { data: trendData, isLoading: trendLoading } =
		api.stats.getDailyTrend.useQuery({
			month: selectedMonth,
			homeCurrency,
		});

	const { totalThisMonth, changeVsLastMonth, dailyAverage, projectedSpend } =
		summaryStats ?? {
			totalThisMonth: 0,
			changeVsLastMonth: null,
			dailyAverage: 0,
			projectedSpend: 0,
		};

	const dailyTrend = trendData ?? [];

	const areaChartConfig: ChartConfig = {
		spend: {
			label: "Cumulative spend",
			color: "hsl(217, 91%, 60%)",
		},
	};

	const categoryBreakdown = useMemo<CategorySegment[]>(() => {
		if (!categoryData) return [];
		return categoryData.map((c, index) => {
			const resolvedColor =
				resolveCategoryColorValue(c.color) ??
				chartPalette[index % chartPalette.length];
			const key = (c.id ?? c.name)
				.toString()
				.replace(/\s+/g, "-")
				.toLowerCase();
			return {
				key,
				name: c.name,
				value: c.value,
				color: resolvedColor,
				categoryColor: c.color,
				categoryId: c.id,
			};
		});
	}, [categoryData]);

	const [activeSliceIndex, setActiveSliceIndex] = useState<number | null>(null);
	const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
		new Set(),
	);

	const visibleCategoryBreakdown = useMemo(() => {
		return categoryBreakdown.filter(
			(segment) =>
				!segment.categoryId || !hiddenCategories.has(segment.categoryId),
		);
	}, [categoryBreakdown, hiddenCategories]);

	const visibleTotal = useMemo(() => {
		return visibleCategoryBreakdown.reduce(
			(sum, segment) => sum + segment.value,
			0,
		);
	}, [visibleCategoryBreakdown]);

	const activeSlice =
		activeSliceIndex !== null
			? visibleCategoryBreakdown[activeSliceIndex]
			: null;

	const toggleCategoryVisibility = (categoryId: string) => {
		setHiddenCategories((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(categoryId)) {
				newSet.delete(categoryId);
			} else {
				newSet.add(categoryId);
			}
			return newSet;
		});
	};

	const handleCategoryClick = (segment: (typeof categoryBreakdown)[number]) => {
		if (categoryClickBehavior === "toggle" && segment.categoryId) {
			toggleCategoryVisibility(segment.categoryId);
		} else {
			router.push("/app/table");
		}
	};

	const pieChartConfig: ChartConfig = useMemo(() => {
		return visibleCategoryBreakdown.reduce<ChartConfig>((config, segment) => {
			config[segment.key] = {
				label: segment.name,
				color: segment.color,
			};
			return config;
		}, {});
	}, [visibleCategoryBreakdown]);

	const handleSliceEnter = (_: unknown, index: number) => {
		setActiveSliceIndex(index);
	};

	const handleSliceLeave = () => {
		setActiveSliceIndex(null);
	};

	const recentExpenses = useMemo(() => {
		const sorted = [...expenses].sort(
			(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
		);
		return sorted.slice(0, 50);
	}, [expenses]);

	const isUsingMockExpenses =
		!expensesFetched || (expensesData?.length ?? 0) === 0;
	const isUsingMockFavorites =
		!favoritesFetched || (favoritesData?.length ?? 0) === 0;

	const handleCreateExpense = () => {
		toast.dismiss();
		toast.info("Starting a new expense");
		openNewExpense();
	};

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
				<Button onClick={handleCreateExpense}>Add expense</Button>
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
						minDate={earliestBudgetMonth ?? undefined}
						onChange={setSelectedMonth}
						value={selectedMonth}
					/>
				}
				title="Overview"
			/>
			<PageContent>
				<div className="space-y-4 lg:space-y-6">
					{isUsingMockExpenses && renderOnboarding()}
					<StatsCards
						categoryBreakdown={categoryBreakdown}
						changeVsLastMonth={changeVsLastMonth}
						dailyAverage={dailyAverage}
						expensesLoading={statsLoading}
						homeCurrency={homeCurrency}
						overviewStats={overviewStats}
						projectedSpend={projectedSpend}
						totalThisMonth={totalThisMonth}
					/>

					<section className="grid gap-4 lg:grid-cols-2">
						<CategoryDonut
							activeSlice={activeSlice}
							activeSliceIndex={activeSliceIndex}
							categoryBreakdown={categoryBreakdown}
							categoryClickBehavior={categoryClickBehavior}
							expensesLoading={categoriesLoading}
							formatMoney={(value: number) =>
								formatCurrency(value, homeCurrency)
							}
							handleCategoryClick={handleCategoryClick}
							handleSliceEnter={handleSliceEnter}
							handleSliceLeave={handleSliceLeave}
							hiddenCategories={hiddenCategories}
							isUsingMockExpenses={isUsingMockExpenses}
							pieChartConfig={pieChartConfig}
							visibleCategoryBreakdown={visibleCategoryBreakdown}
							visibleTotal={visibleTotal}
						/>

						<RecentExpenses
							expensesLoading={expensesLoading}
							formatCurrency={formatCurrency}
							homeCurrency={homeCurrency}
							liveRateToBaseCurrency={liveRateToBaseCurrency}
							recentExpenses={recentExpenses}
						/>
					</section>

					<section className="grid gap-4 lg:grid-cols-3">
						<TrendChart
							areaChartConfig={areaChartConfig}
							dailyTrend={dailyTrend}
							expensesLoading={trendLoading}
							now={now}
						/>

						<FavoritesPanel
							favoriteRates={favoriteRates}
							favoritesLoading={favoritesLoading}
							isUsingMockFavorites={isUsingMockFavorites}
						/>
					</section>
				</div>
			</PageContent>
		</>
	);
}

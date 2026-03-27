"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { useCurrency } from "~/hooks/use-currency";
import { useSettings } from "~/hooks/use-settings";
import { resolveCategoryColorValue } from "~/lib/category-colors";
import {
	CHART_CONFIG_DEFAULTS,
	getCategoryColor,
	OTHER_COLOR,
} from "~/lib/chart-theme";
import {
	getCurrentFiscalMonth,
	getFiscalMonthProgress,
} from "~/lib/fiscal-month";
import { api, type RouterOutputs } from "~/trpc/react";
import type { CategorySegment } from "../app/(dashboard)/_components/category-donut-legend";

export type OverviewStats = RouterOutputs["stats"]["getSummary"] & {
	overviewStats?: RouterOutputs["dashboard"]["getOverviewStats"];
};

export function useOverviewController() {
	const router = useRouter();
	const { openNewExpense } = useExpenseModal();
	const { homeCurrency, usdToHomeRate: liveRateToBaseCurrency } = useCurrency();
	const { data: settings } = useSettings();

	// State
	const fiscalStartDay = settings?.fiscalMonthStartDay ?? 1;
	const settingsReady = !!settings;
	const [selectedMonth, setSelectedMonth] = useState<Date>(() =>
		getCurrentFiscalMonth(new Date(), fiscalStartDay),
	);
	const [activeSliceIndex, setActiveSliceIndex] = useState<number | null>(null);
	const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
		new Set(),
	);

	// Correct selectedMonth once settings load with the actual fiscal start day.
	// The useState initializer runs before settings are available, so it defaults
	// to fiscalStartDay=1. This effect syncs it once we know the real value.
	const hasSyncedFiscalMonth = useRef(false);
	useEffect(() => {
		if (settings && !hasSyncedFiscalMonth.current) {
			hasSyncedFiscalMonth.current = true;
			const correctMonth = getCurrentFiscalMonth(
				new Date(),
				settings.fiscalMonthStartDay ?? 1,
			);
			setSelectedMonth(correctMonth);
		}
	}, [settings]);

	const { data: overviewData, isLoading: isOverviewLoading } =
		api.dashboard.getOverviewData.useQuery(
			{ month: selectedMonth, homeCurrency },
			{ enabled: settingsReady },
		);

	const { data: recentActivity, isLoading: isActivityLoading } =
		api.dashboard.getRecentActivity.useQuery(
			{ homeCurrency },
			{ enabled: settingsReady },
		);

	const { data: dailySpending, isLoading: isHeatmapLoading } =
		api.dashboard.getDailySpending.useQuery(
			{ homeCurrency, days: 90 },
			{ enabled: settingsReady },
		);

	// Destructure / Map for compatibility with existing logic
	const hasExpenses = overviewData?.hasExpenses ?? false;
	const favoritesData = overviewData?.favorites;
	const overviewStats = overviewData?.overviewStats;
	const earliestBudgetMonth = overviewData?.earliestBudgetMonth;
	const summaryStats = overviewData?.summaryStats;
	const categoryData = overviewData?.categoryData;
	const trendData = overviewData?.trendData;
	const serverTime = overviewData?.serverTime;

	const dataLoading = isOverviewLoading || !settingsReady;
	const activityLoading = isActivityLoading || !settingsReady;
	const heatmapLoading = isHeatmapLoading || !settingsReady;

	const favoritesFetched = !!overviewData;

	// Transformations
	const categoryClickBehavior = settings?.categoryClickBehavior ?? "toggle";

	const favoriteRates = useMemo(() => {
		if (!favoritesData) return [];
		return favoritesData.map((fav) => ({
			id: fav.id,
			currency: fav.rate.currency,
			type: fav.rate.type,
			rate: Number(fav.rate.rate),
			date: new Date(fav.rate.date),
		}));
	}, [favoritesData]);

	// Use server time as the authoritative "now" to avoid timezone mismatches
	// Server is in NY timezone, so this ensures consistent date handling
	const now = useMemo(
		() => (serverTime ? new Date(serverTime) : new Date()),
		[serverTime],
	);

	const categoryBreakdown = useMemo<CategorySegment[]>(() => {
		if (!categoryData || categoryData.length === 0) return [];

		// Single pass: partition into visible and hidden
		const visibleData: typeof categoryData = [];
		const hiddenData: typeof categoryData = [];
		let totalVisible = 0;

		for (const c of categoryData) {
			if (hiddenCategories.has(c.id ?? "")) {
				hiddenData.push(c);
			} else {
				visibleData.push(c);
				totalVisible += c.value;
			}
		}

		// Sort only the visible set (needed for top-6 promotion)
		visibleData.sort((a, b) => b.value - a.value);

		const result: CategorySegment[] = [];
		let otherValue = 0;

		for (let index = 0; index < visibleData.length; index++) {
			const c = visibleData[index]!;
			const percentageOfVisible =
				totalVisible > 0 ? (c.value / totalVisible) * 100 : 0;

			if (index < 6 && percentageOfVisible >= 3) {
				result.push({
					key: (c.id ?? c.name).toString().replace(/\s+/g, "-").toLowerCase(),
					name: c.name,
					value: c.value,
					color: resolveCategoryColorValue(c.color) ?? getCategoryColor(index),
					categoryColor: c.color,
					categoryId: c.id,
					icon: c.icon,
				});
			} else {
				otherValue += c.value;
			}
		}

		if (otherValue > 0) {
			result.push({
				key: "other",
				name: "Other",
				value: otherValue,
				color: OTHER_COLOR,
				categoryColor: "stone-700",
				categoryId: "other",
			});
		}

		// Add hidden categories back to legend (sorted by value)
		hiddenData.sort((a, b) => b.value - a.value);
		for (const c of hiddenData) {
			result.push({
				key: (c.id ?? c.name).toString().replace(/\s+/g, "-").toLowerCase(),
				name: c.name,
				value: c.value,
				color:
					resolveCategoryColorValue(c.color) ?? "hsl(var(--muted-foreground))",
				categoryColor: c.color,
				categoryId: c.id,
			});
		}

		return result;
	}, [categoryData, hiddenCategories]);

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

	const pieChartConfig = useMemo(() => {
		return visibleCategoryBreakdown.reduce<
			Record<string, { label: string; color: string }>
		>((config, segment) => {
			config[segment.key] = {
				label: segment.name,
				color: segment.color ?? "hsl(var(--muted))",
			};
			return config;
		}, {});
	}, [visibleCategoryBreakdown]);

	// Actions
	const toggleCategoryVisibility = (categoryId: string) => {
		setHiddenCategories((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(categoryId)) newSet.delete(categoryId);
			else newSet.add(categoryId);
			return newSet;
		});
	};

	const handleCategoryClick = (segment: CategorySegment) => {
		if (categoryClickBehavior === "toggle" && segment.categoryId) {
			toggleCategoryVisibility(segment.categoryId);
		} else {
			router.push("/transactions");
		}
	};

	const handleCreateExpense = () => {
		toast.dismiss();
		toast.info("Starting a new expense");
		openNewExpense();
	};

	const budgetPacing = useMemo(() => {
		const progress = getFiscalMonthProgress(now, selectedMonth, fiscalStartDay);
		return {
			totalBudget: overviewStats?.dailyBudgetPace.totalBudget ?? 0,
			totalSpent: overviewStats?.dailyBudgetPace.totalSpent ?? 0,
			variableBudget: overviewStats?.dailyBudgetPace.variableBudget ?? 0,
			variableSpent: overviewStats?.dailyBudgetPace.variableSpent ?? 0,
			daysInMonth: progress.daysInPeriod,
			currentDay: progress.isCurrentPeriod
				? progress.currentDay
				: progress.daysInPeriod,
		};
	}, [now, selectedMonth, fiscalStartDay, overviewStats]);

	return {
		state: {
			selectedMonth,
			activeSliceIndex,
			activeSlice,
			hiddenCategories,
			now,
			serverTime: serverTime ? now : undefined,
			isUsingMockExpenses: !overviewData || !hasExpenses,
			isUsingMockFavorites:
				!favoritesFetched || (favoritesData?.length ?? 0) === 0,
		},
		data: {
			overviewStats,
			summaryStats,
			categoryBreakdown,
			visibleCategoryBreakdown,
			visibleTotal,
			recentActivity: recentActivity ?? [],
			favoriteRates,
			dailyTrend: trendData ?? [],
			dailySpending: dailySpending ?? [],
			earliestBudgetMonth,
			pieChartConfig,
			areaChartConfig: CHART_CONFIG_DEFAULTS.pacingChart,
			categoryClickBehavior,
			homeCurrency,
			liveRateToBaseCurrency,
			budgetPacing,
		},
		isLoading: {
			expenses: dataLoading,
			favorites: dataLoading,
			stats: dataLoading,
			categories: dataLoading,
			trend: dataLoading,
			activity: activityLoading,
			heatmap: heatmapLoading,
		},
		actions: {
			setSelectedMonth,
			setActiveSliceIndex,
			toggleCategoryVisibility,
			handleCategoryClick,
			handleCreateExpense,
		},
	};
}

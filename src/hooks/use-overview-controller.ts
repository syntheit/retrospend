"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCurrency } from "~/hooks/use-currency";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { resolveCategoryColorValue } from "~/lib/category-colors";
import { normalizeExpensesFromApi } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import type { CategorySegment } from "../app/app/(dashboard)/_components/category-donut-legend";
import { CHART_CONFIG_DEFAULTS, OTHER_COLOR, getCategoryColor } from "~/lib/chart-theme";

export type OverviewStats = RouterOutputs["stats"]["getSummary"] & {
  overviewStats?: RouterOutputs["dashboard"]["getOverviewStats"];
};


export function useOverviewController() {
  const router = useRouter();
  const { openNewExpense } = useExpenseModal();
  const { homeCurrency, usdToHomeRate: liveRateToBaseCurrency } = useCurrency();

  // State
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => new Date());
  const [activeSliceIndex, setActiveSliceIndex] = useState<number | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  // Queries
  const { data: expensesData, isLoading: expensesLoading, isFetched: expensesFetched } = 
    api.expense.listFinalized.useQuery();
  
  const { data: favoritesData, isLoading: favoritesLoading, isFetched: favoritesFetched } = 
    api.preferences.getFavoriteExchangeRates.useQuery();
    
  const { data: settings } = api.settings.getGeneral.useQuery();
  
  const { data: overviewStats } = api.dashboard.getOverviewStats.useQuery({
    month: selectedMonth,
    homeCurrency,
  });
  
  const { data: earliestBudgetMonth } = api.budget.getEarliestBudgetMonth.useQuery();
  
  const { data: summaryStats, isLoading: statsLoading } = api.stats.getSummary.useQuery({
    month: selectedMonth,
    homeCurrency,
  });

  const { data: categoryData, isLoading: categoriesLoading } = api.stats.getCategoryBreakdown.useQuery({
    month: selectedMonth,
    homeCurrency,
  });

  const { data: trendData, isLoading: trendLoading } = api.stats.getDailyTrend.useQuery({
    month: selectedMonth,
    homeCurrency,
  });

  // Transformations
  const categoryClickBehavior = settings?.categoryClickBehavior ?? "toggle";

  const expenses = useMemo(() => normalizeExpensesFromApi(expensesData ?? []), [expensesData]);

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

  const now = new Date();

  const categoryBreakdown = useMemo<CategorySegment[]>(() => {
    if (!categoryData || categoryData.length === 0) return [];

    // 1. Separate based on hiddenCategories
    const visibleData = categoryData.filter((c) => !hiddenCategories.has(c.id ?? ""));
    const hiddenData = categoryData.filter((c) => hiddenCategories.has(c.id ?? ""));

    // 2. Identify which visible ones should be "Main" vs "Other"
    const totalVisible = visibleData.reduce((sum, c) => sum + c.value, 0);
    const sortedVisible = [...visibleData].sort((a, b) => b.value - a.value);

    const mainSegments: CategorySegment[] = [];
    const otherVisibleItems: typeof categoryData = [];

    sortedVisible.forEach((c, index) => {
      const percentageOfVisible = totalVisible > 0 ? (c.value / totalVisible) * 100 : 0;
      
      // DYNAMIC PROMOTION: We check based on the CURRENT visible ranking and new total
      if (index < 6 && percentageOfVisible >= 3) {
        mainSegments.push({
          key: (c.id ?? c.name).toString().replace(/\s+/g, "-").toLowerCase(),
          name: c.name,
          value: c.value,
          color: resolveCategoryColorValue(c.color) ?? getCategoryColor(index),
          categoryColor: c.color,
          categoryId: c.id,
        });
      } else {
        otherVisibleItems.push(c);
      }
    });

    const result: CategorySegment[] = [...mainSegments];

    // 3. Add "Other" segment for remaining visible items
    if (otherVisibleItems.length > 0) {
      result.push({
        key: "other",
        name: "Other",
        value: otherVisibleItems.reduce((sum, c) => sum + c.value, 0),
        color: OTHER_COLOR,
        categoryColor: "stone-700",
        categoryId: "other",
      });
    }

    // 4. Add Hidden Categories back to legend so they can be toggled
    const sortedHidden = [...hiddenData].sort((a, b) => b.value - a.value);
    sortedHidden.forEach((c) => {
      result.push({
        key: (c.id ?? c.name).toString().replace(/\s+/g, "-").toLowerCase(),
        name: c.name,
        value: c.value,
        color: resolveCategoryColorValue(c.color) ?? "hsl(var(--muted-foreground))",
        categoryColor: c.color,
        categoryId: c.id,
      });
    });

    return result;
  }, [categoryData, hiddenCategories]);

  const visibleCategoryBreakdown = useMemo(() => {
    return categoryBreakdown.filter(
      (segment) => !segment.categoryId || !hiddenCategories.has(segment.categoryId)
    );
  }, [categoryBreakdown, hiddenCategories]);

  const visibleTotal = useMemo(() => {
    return visibleCategoryBreakdown.reduce((sum, segment) => sum + segment.value, 0);
  }, [visibleCategoryBreakdown]);

  const activeSlice = activeSliceIndex !== null ? visibleCategoryBreakdown[activeSliceIndex] : null;

  const pieChartConfig = useMemo(() => {
    return visibleCategoryBreakdown.reduce<Record<string, { label: string; color: string }>>((config, segment) => {
      config[segment.key] = {
        label: segment.name,
        color: segment.color ?? "hsl(var(--muted))",
      };
      return config;
    }, {});
  }, [visibleCategoryBreakdown]);

  const recentExpenses = useMemo(() => {
    const sorted = [...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted.slice(0, 50);
  }, [expenses]);

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
      router.push("/app/table");
    }
  };

  const handleCreateExpense = () => {
    toast.dismiss();
    toast.info("Starting a new expense");
    openNewExpense();
  };

  return {
    state: {
      selectedMonth,
      activeSliceIndex,
      activeSlice,
      hiddenCategories,
      now,
      isUsingMockExpenses: !expensesFetched || (expensesData?.length ?? 0) === 0,
      isUsingMockFavorites: !favoritesFetched || (favoritesData?.length ?? 0) === 0,
    },
    data: {
      overviewStats,
      summaryStats,
      categoryBreakdown,
      visibleCategoryBreakdown,
      visibleTotal,
      recentExpenses,
      favoriteRates,
      dailyTrend: trendData ?? [],
      earliestBudgetMonth,
      pieChartConfig,
      areaChartConfig: CHART_CONFIG_DEFAULTS.cumulativeSpend,
      categoryClickBehavior,
      homeCurrency,
      liveRateToBaseCurrency,
    },
    isLoading: {
      expenses: expensesLoading,
      favorites: favoritesLoading,
      stats: statsLoading,
      categories: categoriesLoading,
      trend: trendLoading,
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

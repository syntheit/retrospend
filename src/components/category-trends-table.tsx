"use client";

import type { VisibilityState } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { DataTable } from "~/components/data-table";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import {
	type BucketSize,
	formatXAxisTick,
	generateBucketKeys,
	getBucketKey,
	getBucketSize,
	getBucketStartDate,
} from "~/lib/chart-granularity";
import {
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
} from "~/lib/utils";
import {
	type CategoryTrendRow,
	createCategoryTrendColumns,
} from "./category-trends-columns";
import { useIsMobile } from "~/hooks/use-mobile";

function getPeriodLabel(bs: BucketSize): string {
	switch (bs) {
		case "day":
			return "Day";
		case "week":
			return "Week";
		case "month":
			return "Month";
	}
}

interface CategoryTrendsTableProps {
	expenses: NormalizedExpense[];
	baseCurrency: string;
	liveRateToBaseCurrency: number | null;
	dateRange: { from: Date; to: Date };
}

export function CategoryTrendsTable({
	expenses,
	baseCurrency,
	liveRateToBaseCurrency,
	dateRange,
}: CategoryTrendsTableProps) {
	const isMobile = useIsMobile();

	const bucketSize = useMemo(
		() => getBucketSize(dateRange.from, dateRange.to),
		[dateRange],
	);

	const categoryData = useMemo<CategoryTrendRow[]>(() => {
		// Generate all bucket keys for the date range
		const bucketKeys = generateBucketKeys(
			dateRange.from,
			dateRange.to,
			bucketSize,
		);

		const categoryMap = new Map<
			string,
			{
				category: { id: string; name: string; color: string };
				bucketTotals: Map<string, number>;
			}
		>();

		// Process expenses
		expenses.forEach((expense) => {
			if (!expense.category) return;
			if (expense.date < dateRange.from || expense.date > dateRange.to) return;

			const categoryKey = expense.category.id;
			const bucketKey = getBucketKey(expense.date, bucketSize);
			const amount = convertExpenseAmountForDisplay(
				expense,
				baseCurrency,
				liveRateToBaseCurrency,
			);

			if (!categoryMap.has(categoryKey)) {
				categoryMap.set(categoryKey, {
					category: expense.category,
					bucketTotals: new Map(),
				});
			}

			const catData = categoryMap.get(categoryKey);
			if (!catData) return;
			catData.bucketTotals.set(
				bucketKey,
				(catData.bucketTotals.get(bucketKey) || 0) + amount,
			);
		});

		// Convert to array and calculate averages and trends
		const result: CategoryTrendRow[] = Array.from(categoryMap.values()).map(
			(data) => {
				const trendData = bucketKeys.map((key) => {
					const bucketDate = getBucketStartDate(key, bucketSize);
					return {
						key,
						label: formatXAxisTick(bucketDate, bucketSize),
						amount: data.bucketTotals.get(key) || 0,
					};
				});

				const periodsWithExpenses = trendData.filter(
					(item) => item.amount > 0,
				);
				const totalOverActivePeriods = periodsWithExpenses.reduce(
					(sum, item) => sum + item.amount,
					0,
				);
				const periodAverage =
					periodsWithExpenses.length > 0
						? totalOverActivePeriods / periodsWithExpenses.length
						: 0;

				// Current period total (last bucket)
				const currentPeriodTotal =
					trendData[trendData.length - 1]?.amount || 0;

				const firstPeriod = trendData[0]?.amount || 0;
				const lastPeriod = trendData[trendData.length - 1]?.amount || 0;
				const percentageChange =
					firstPeriod > 0
						? ((lastPeriod - firstPeriod) / firstPeriod) * 100
						: 0;

				const previousPeriod =
					trendData[trendData.length - 2]?.amount || 0;
				const periodOverPeriodChange =
					previousPeriod > 0
						? ((currentPeriodTotal - previousPeriod) / previousPeriod) * 100
						: 0;

				// Determine if trending down (good for spending) - compare first half vs second half
				const midpoint = Math.floor(trendData.length / 2);
				const firstHalf =
					trendData
						.slice(0, midpoint)
						.reduce((sum, item) => sum + item.amount, 0) /
					(midpoint || 1);
				const secondHalf =
					trendData
						.slice(midpoint)
						.reduce((sum, item) => sum + item.amount, 0) /
					(trendData.length - midpoint || 1);
				const isTrendingDown = secondHalf < firstHalf;

				return {
					id: data.category.id,
					category: data.category,
					currentPeriodTotal,
					periodAverage,
					trendData,
					isTrendingDown,
					percentageChange,
					periodOverPeriodChange,
				};
			},
		);

		return result;
	}, [expenses, dateRange, bucketSize, baseCurrency, liveRateToBaseCurrency]);

	const { formatCurrency: formatWithSettings } = useCurrencyFormatter();

	const formatAmount = useCallback(
		(amount: number) => formatWithSettings(amount, baseCurrency),
		[formatWithSettings, baseCurrency],
	);

	const columns = useMemo(
		() => createCategoryTrendColumns(formatAmount, bucketSize, getPeriodLabel),
		[formatAmount, bucketSize],
	);

	const columnVisibility: VisibilityState = isMobile
		? { periodAverage: false }
		: {};

	if (categoryData.length === 0) {
		return (
			<div className="space-y-4">
				<div>
					<h3 className="font-semibold text-lg">Category Trends</h3>
					<p className="text-muted-foreground text-sm">
						Spending trends by category
					</p>
				</div>
				<div className="flex h-[300px] items-center justify-center">
					<p className="text-muted-foreground">No categorized expenses found</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div>
				<h3 className="font-semibold text-lg">Category Trends</h3>
				<p className="text-muted-foreground text-sm">
					{getPeriodLabel(bucketSize)}ly spending trends by category
				</p>
			</div>

			<DataTable
				columns={columns}
				columnVisibility={columnVisibility}
				data={categoryData}
				initialSorting={[{ id: "currentPeriodTotal", desc: true }]}
				searchable={false}
			/>
		</div>
	);
}

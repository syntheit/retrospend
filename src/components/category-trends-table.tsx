"use client";

import { useMemo } from "react";
import type { TooltipProps } from "recharts";
import {
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import {
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
	Tooltip as UITooltip,
} from "~/components/ui/tooltip";
import {
	type BucketSize,
	formatXAxisTick,
	generateBucketKeys,
	getBucketKey,
	getBucketSize,
	getBucketStartDate,
} from "~/lib/chart-granularity";
import type { CategoryColor } from "~/lib/constants";
import {
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
} from "~/lib/utils";

// Map category color keys to actual hex color values
const CATEGORY_COLOR_HEX_MAP: Record<CategoryColor, string> = {
	emerald: "#059669",
	blue: "#2563eb",
	sky: "#0ea5e9",
	cyan: "#0891b2",
	teal: "#0d9488",
	orange: "#f97316",
	amber: "#f59e0b",
	violet: "#7c3aed",
	pink: "#ec4899",
	fuchsia: "#c026d3",
	indigo: "#4f46e5",
	slate: "#334155",
	zinc: "#52525b",
	lime: "#65a30d",
	neutral: "#525252",
	gray: "#6b7280",
	purple: "#9333ea",
	yellow: "#eab308",
	stone: "#78716c",
	rose: "#f43f5e",
	red: "#dc2626",
};

interface CategoryTrendData {
	category: {
		id: string;
		name: string;
		color: string;
	};
	currentPeriodTotal: number;
	periodAverage: number;
	trendData: Array<{
		key: string;
		label: string;
		amount: number;
	}>;
	isTrendingDown: boolean;
	percentageChange: number;
	periodOverPeriodChange: number;
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
	const bucketSize = useMemo(
		() => getBucketSize(dateRange.from, dateRange.to),
		[dateRange],
	);

	const categoryData = useMemo<CategoryTrendData[]>(() => {
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

			const categoryData = categoryMap.get(categoryKey);
			if (!categoryData) return;
			categoryData.bucketTotals.set(
				bucketKey,
				(categoryData.bucketTotals.get(bucketKey) || 0) + amount,
			);
		});

		// Convert to array and calculate averages and trends
		const result: CategoryTrendData[] = Array.from(categoryMap.values())
			.map((data) => {
				const trendData = bucketKeys.map((key) => {
					const bucketDate = getBucketStartDate(key, bucketSize);
					return {
						key,
						label: formatXAxisTick(bucketDate, bucketSize),
						amount: data.bucketTotals.get(key) || 0,
					};
				});

				const periodsWithExpenses = trendData.filter((item) => item.amount > 0);
				const totalOverActivePeriods = periodsWithExpenses.reduce(
					(sum, item) => sum + item.amount,
					0,
				);
				const periodAverage =
					periodsWithExpenses.length > 0
						? totalOverActivePeriods / periodsWithExpenses.length
						: 0;

				// Current period total (last bucket)
				const currentPeriodTotal = trendData[trendData.length - 1]?.amount || 0;

				const firstPeriod = trendData[0]?.amount || 0;
				const lastPeriod = trendData[trendData.length - 1]?.amount || 0;
				const percentageChange =
					firstPeriod > 0
						? ((lastPeriod - firstPeriod) / firstPeriod) * 100
						: 0;

				const previousPeriod = trendData[trendData.length - 2]?.amount || 0;
				const periodOverPeriodChange =
					previousPeriod > 0
						? ((currentPeriodTotal - previousPeriod) / previousPeriod) * 100
						: 0;

				// Determine if trending down (good for spending) - compare first half vs second half
				const midpoint = Math.floor(trendData.length / 2);
				const firstHalf =
					trendData
						.slice(0, midpoint)
						.reduce((sum, item) => sum + item.amount, 0) / (midpoint || 1);
				const secondHalf =
					trendData
						.slice(midpoint)
						.reduce((sum, item) => sum + item.amount, 0) /
					(trendData.length - midpoint || 1);
				const isTrendingDown = secondHalf < firstHalf;

				return {
					category: data.category,
					currentPeriodTotal: currentPeriodTotal,
					periodAverage: periodAverage,
					trendData,
					isTrendingDown,
					percentageChange,
					periodOverPeriodChange,
				};
			})
			// Sort by current period total (highest first)
			.sort((a, b) => b.currentPeriodTotal - a.currentPeriodTotal);

		return result;
	}, [expenses, dateRange, bucketSize, baseCurrency, liveRateToBaseCurrency]);

	const getPeriodLabel = (bucketSize: BucketSize): string => {
		switch (bucketSize) {
			case "day":
				return "Day";
			case "week":
				return "Week";
			case "month":
				return "Month";
		}
	};

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

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		}).format(amount);
	};

	const SparklineTooltip = ({
		active,
		payload,
	}: TooltipProps<number, string>) => {
		if (active && payload && payload.length) {
			const data = payload[0]?.payload;
			return (
				<div className="rounded-lg border border-border bg-background p-2 text-xs shadow-md">
					<div className="font-medium">{data?.label}</div>
					<div className="text-muted-foreground">
						{formatCurrency(data?.amount || 0)}
					</div>
				</div>
			);
		}
		return null;
	};

	const formatPercentage = (percentage: number) => {
		const sign = percentage >= 0 ? "+" : "";
		return `${sign}${percentage.toFixed(1)}%`;
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="font-semibold text-lg">Category Trends</h3>
				<p className="text-muted-foreground text-sm">
					{getPeriodLabel(bucketSize)}ly spending trends by category
				</p>
			</div>

			<div className="overflow-hidden rounded-lg border">
				<div className="w-full overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="min-w-[150px]">Category</TableHead>
								<TableHead className="text-right">
									This {getPeriodLabel(bucketSize)}
								</TableHead>
								<TableHead className="hidden text-right md:table-cell">
									Avg/{getPeriodLabel(bucketSize)}
								</TableHead>
								<TooltipProvider>
									<UITooltip>
										<TooltipTrigger asChild>
											<TableHead className="cursor-help text-center">
												Trend
											</TableHead>
										</TooltipTrigger>
										<TooltipContent>
											<div className="max-w-xs text-sm">
												<div className="mb-1 font-medium">Trend Analysis</div>
												<div className="space-y-1 text-xs">
													<div>
														<strong>Avg/{getPeriodLabel(bucketSize)}:</strong>{" "}
														Average of periods with expenses
													</div>
													<div>
														<strong>Top:</strong> Overall percentage change
													</div>
													<div>
														<strong>Bottom:</strong>{" "}
														{getPeriodLabel(bucketSize)}-over-
														{getPeriodLabel(bucketSize).toLowerCase()} change
													</div>
													<div className="text-muted-foreground">
														Green ↓ = spending decreased (good)
													</div>
													<div className="text-muted-foreground">
														Red ↑ = spending increased
													</div>
												</div>
											</div>
										</TooltipContent>
									</UITooltip>
								</TooltipProvider>
							</TableRow>
						</TableHeader>
						<TableBody>
							{categoryData.map((item) => (
								<TableRow key={item.category.id}>
									<TableCell>
										<div className="flex items-center gap-2">
											<div
												className="h-3 w-3 flex-shrink-0 rounded-full"
												style={{
													backgroundColor:
														CATEGORY_COLOR_HEX_MAP[
															item.category.color as CategoryColor
														] || "#6b7280",
												}}
											/>
											<span className="font-medium">{item.category.name}</span>
										</div>
									</TableCell>
									<TableCell className="text-right font-medium">
										{formatCurrency(item.currentPeriodTotal)}
									</TableCell>
									<TableCell className="hidden text-right text-muted-foreground md:table-cell">
										{formatCurrency(item.periodAverage)}
									</TableCell>
									<TableCell className="text-center">
										<div className="flex items-center justify-center gap-3">
											{/* Sparkline Chart */}
											<div className="h-8 w-20">
												<ResponsiveContainer height="100%" width="100%">
													<LineChart
														data={item.trendData}
														margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
													>
														<XAxis dataKey="label" hide />
														<YAxis domain={["dataMin", "dataMax"]} hide />
														<Tooltip content={<SparklineTooltip />} />
														<Line
															activeDot={{ r: 2 }}
															dataKey="amount"
															dot={false}
															stroke={
																item.isTrendingDown ? "#16a34a" : "#dc2626"
															}
															strokeWidth={1.5}
															type="monotone"
														/>
													</LineChart>
												</ResponsiveContainer>
											</div>

											{/* Trend Information */}
											<div className="flex min-w-0 flex-col items-center gap-1">
												{/* Overall trend */}
												<div
													className={`font-medium text-xs ${
														item.percentageChange < 0
															? "text-green-600"
															: item.percentageChange > 0
																? "text-red-600"
																: "text-muted-foreground"
													}`}
												>
													{item.percentageChange < 0
														? "↓"
														: item.percentageChange > 0
															? "↑"
															: "→"}
													{formatPercentage(Math.abs(item.percentageChange))}
												</div>

												{/* Period-over-period */}
												<div
													className={`text-xs ${
														item.periodOverPeriodChange < 0
															? "text-green-600"
															: item.periodOverPeriodChange > 0
																? "text-red-600"
																: "text-muted-foreground"
													}`}
												>
													{item.periodOverPeriodChange < 0
														? "↓"
														: item.periodOverPeriodChange > 0
															? "↑"
															: "→"}
													{formatPercentage(
														Math.abs(item.periodOverPeriodChange),
													)}
												</div>
											</div>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	);
}

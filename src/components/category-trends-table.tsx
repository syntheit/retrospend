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
	currentMonthTotal: number;
	sixMonthAverage: number;
	trendData: Array<{
		month: string;
		amount: number;
	}>;
	isTrendingDown: boolean;
	percentageChange: number;
	monthOverMonthChange: number;
}

interface CategoryTrendsTableProps {
	expenses: NormalizedExpense[];
	baseCurrency: string;
	liveRateToBaseCurrency: number | null;
}

export function CategoryTrendsTable({
	expenses,
	baseCurrency,
	liveRateToBaseCurrency,
}: CategoryTrendsTableProps) {
	const categoryData = useMemo<CategoryTrendData[]>(() => {
		const now = new Date();
		const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

		// Create a map of categories to their expense data
		const categoryMap = new Map<
			string,
			{
				category: { id: string; name: string; color: string };
				monthlyTotals: Map<string, number>; // month-year -> total
				currentMonthTotal: number;
			}
		>();

		// Process expenses
		expenses.forEach((expense) => {
			if (!expense.category) return;

			const categoryKey = expense.category.id;
			const expenseDate = expense.date;
			const monthKey = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, "0")}`;
			const amount = convertExpenseAmountForDisplay(
				expense,
				baseCurrency,
				liveRateToBaseCurrency,
			);

			if (!categoryMap.has(categoryKey)) {
				categoryMap.set(categoryKey, {
					category: expense.category,
					monthlyTotals: new Map(),
					currentMonthTotal: 0,
				});
			}

			const categoryData = categoryMap.get(categoryKey);
			if (!categoryData) return;
			categoryData.monthlyTotals.set(
				monthKey,
				(categoryData.monthlyTotals.get(monthKey) || 0) + amount,
			);

			// Track current month total
			if (expenseDate >= currentMonth) {
				categoryData.currentMonthTotal += amount;
			}
		});

		// Convert to array and calculate averages and trends
		const result: CategoryTrendData[] = Array.from(categoryMap.values())
			.map((data) => {
				// Get last 6 months of data
				const months: string[] = [];
				for (let i = 5; i >= 0; i--) {
					const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
					months.push(
						`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
					);
				}

				const trendData = months.map((month) => ({
					month: month.split("-")[1] ?? "01", // Just show month number
					amount: data.monthlyTotals.get(month) || 0,
				}));

				// Calculate 6-month average (only including months with actual expenses)
				const monthsWithExpenses = trendData.filter((item) => item.amount > 0);
				const totalOverActiveMonths = monthsWithExpenses.reduce(
					(sum, item) => sum + item.amount,
					0,
				);
				const sixMonthAverage =
					monthsWithExpenses.length > 0
						? totalOverActiveMonths / monthsWithExpenses.length
						: 0;

				// Calculate percentage change over 6 months
				const firstMonth = trendData[0]?.amount || 0;
				const lastMonth = trendData[trendData.length - 1]?.amount || 0;
				const percentageChange =
					firstMonth > 0 ? ((lastMonth - firstMonth) / firstMonth) * 100 : 0;

				// Calculate month-over-month change (current vs previous month)
				const currentMonth = trendData[trendData.length - 1]?.amount || 0;
				const previousMonth = trendData[trendData.length - 2]?.amount || 0;
				const monthOverMonthChange =
					previousMonth > 0
						? ((currentMonth - previousMonth) / previousMonth) * 100
						: 0;

				// Determine if trending down (good for spending) - compare first half vs second half
				const firstHalf =
					trendData.slice(0, 3).reduce((sum, item) => sum + item.amount, 0) / 3;
				const secondHalf =
					trendData.slice(3, 6).reduce((sum, item) => sum + item.amount, 0) / 3;
				const isTrendingDown = secondHalf < firstHalf;

				return {
					category: data.category,
					currentMonthTotal: data.currentMonthTotal,
					sixMonthAverage: sixMonthAverage,
					trendData,
					isTrendingDown,
					percentageChange,
					monthOverMonthChange,
				};
			})
			// Sort by current month total (highest first)
			.sort((a, b) => b.currentMonthTotal - a.currentMonthTotal);

		return result;
	}, [expenses, baseCurrency, liveRateToBaseCurrency]);

	if (categoryData.length === 0) {
		return (
			<div className="space-y-4">
				<div>
					<h3 className="font-semibold text-lg">Category Trends</h3>
					<p className="text-muted-foreground text-sm">
						Monthly spending trends by category
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
		label,
	}: TooltipProps<number, string>) => {
		if (active && payload && payload.length) {
			const data = payload[0]?.payload;
			return (
				<div className="rounded-lg border border-border bg-background p-2 text-xs shadow-md">
					<div className="font-medium">Month {label}</div>
					<div className="text-muted-foreground">
						{formatCurrency(data.amount)}
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
					Monthly spending trends by category
				</p>
			</div>

			<div className="rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Category</TableHead>
							<TableHead className="text-right">This Month</TableHead>
							<TableHead className="text-right">Avg/Month</TableHead>
							<TooltipProvider>
								<UITooltip>
									<TooltipTrigger asChild>
										<TableHead className="cursor-help text-center">
											6M Trend
										</TableHead>
									</TooltipTrigger>
									<TooltipContent>
										<div className="max-w-xs text-sm">
											<div className="mb-1 font-medium">Trend Analysis</div>
											<div className="space-y-1 text-xs">
												<div>
													<strong>Avg/Month:</strong> Average of months with
													expenses
												</div>
												<div>
													<strong>Top:</strong> 6-month percentage change
												</div>
												<div>
													<strong>Bottom:</strong> Month-over-month change
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
									{formatCurrency(item.currentMonthTotal)}
								</TableCell>
								<TableCell className="text-right text-muted-foreground">
									{formatCurrency(item.sixMonthAverage)}
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
													<XAxis dataKey="month" hide />
													<YAxis domain={["dataMin", "dataMax"]} hide />
													<Tooltip content={<SparklineTooltip />} />
													<Line
														activeDot={{ r: 2 }}
														dataKey="amount"
														dot={false}
														stroke={item.isTrendingDown ? "#16a34a" : "#dc2626"}
														strokeWidth={1.5}
														type="monotone"
													/>
												</LineChart>
											</ResponsiveContainer>
										</div>

										{/* Trend Information */}
										<div className="flex min-w-0 flex-col items-center gap-1">
											{/* 6-month trend */}
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

											{/* Month-over-month */}
											<div
												className={`text-xs ${
													item.monthOverMonthChange < 0
														? "text-green-600"
														: item.monthOverMonthChange > 0
															? "text-red-600"
															: "text-muted-foreground"
												}`}
											>
												{item.monthOverMonthChange < 0
													? "↓"
													: item.monthOverMonthChange > 0
														? "↑"
														: "→"}
												{formatPercentage(Math.abs(item.monthOverMonthChange))}
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
	);
}

"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
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

interface MonthlyPacingChartProps {
	expenses: NormalizedExpense[];
	totalBudget?: number;
	baseCurrency: string;
	liveRateToBaseCurrency: number | null;
	dateRange: { from: Date; to: Date };
}

export function MonthlyPacingChart({
	expenses,
	totalBudget,
	baseCurrency,
	liveRateToBaseCurrency,
	dateRange,
}: MonthlyPacingChartProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const bucketSize = useMemo(
		() => getBucketSize(dateRange.from, dateRange.to),
		[dateRange],
	);

	const chartData = useMemo(() => {
		// Generate all bucket keys for the range
		const bucketKeys = generateBucketKeys(
			dateRange.from,
			dateRange.to,
			bucketSize,
		);

		// Group expenses by bucket
		const bucketTotals = new Map<string, number>();

		expenses.forEach((expense) => {
			if (expense.date < dateRange.from || expense.date > dateRange.to) return;

			const key = getBucketKey(expense.date, bucketSize);
			const amount = convertExpenseAmountForDisplay(
				expense,
				baseCurrency,
				liveRateToBaseCurrency,
			);
			bucketTotals.set(key, (bucketTotals.get(key) || 0) + amount);
		});

		// Build cumulative data
		let cumulative = 0;
		const data = bucketKeys.map((key) => {
			const amount = bucketTotals.get(key) || 0;
			cumulative += amount;
			const bucketDate = getBucketStartDate(key, bucketSize);

			return {
				key,
				date: bucketDate,
				label: formatXAxisTick(bucketDate, bucketSize),
				amount: Math.round(amount * 100) / 100,
				cumulative: Math.round(cumulative * 100) / 100,
			};
		});

		// Calculate budget pace line (linear from 0 to totalBudget)
		if (totalBudget && data.length > 0) {
			const budgetPerBucket = totalBudget / data.length;
			let budgetCumulative = 0;
			data.forEach((d, i) => {
				budgetCumulative = budgetPerBucket * (i + 1);
				(d as typeof d & { budgetPace: number }).budgetPace =
					Math.round(budgetCumulative * 100) / 100;
			});
		}

		return data;
	}, [
		expenses,
		dateRange,
		bucketSize,
		baseCurrency,
		liveRateToBaseCurrency,
		totalBudget,
	]);

	const comparison = useMemo(() => {
		if (chartData.length === 0) return { status: "No data", difference: 0 };

		const totalSpent = chartData[chartData.length - 1]?.cumulative || 0;

		if (totalBudget) {
			const difference = totalSpent - totalBudget;
			const formattedDifference = formatCurrency(
				Math.abs(difference),
				baseCurrency,
			);
			const status =
				difference < 0
					? `${formattedDifference} under budget`
					: difference > 0
						? `${formattedDifference} over budget`
						: "On budget";
			return { status, difference };
		}

		return {
			status: `Total: ${formatCurrency(totalSpent, baseCurrency)}`,
			difference: 0,
		};
	}, [chartData, totalBudget, baseCurrency, formatCurrency]);

	const getBucketLabel = (bucketSize: BucketSize): string => {
		switch (bucketSize) {
			case "day":
				return "daily";
			case "week":
				return "weekly";
			case "month":
				return "monthly";
		}
	};

	const chartConfig = {
		cumulative: {
			label: "Cumulative",
			color: "#ea580c",
		},
		budgetPace: {
			label: "Budget Pace",
			color: "#2563eb",
		},
	} satisfies ChartConfig;

	return (
		<div className="min-w-0 space-y-4">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h3 className="font-semibold text-lg">Spending Over Time</h3>
					<p className="text-muted-foreground text-sm">
						Cumulative {getBucketLabel(bucketSize)} spending
						{totalBudget ? " vs. budget" : ""}
					</p>
				</div>
				<div className="sm:text-right">
					<p
						className={`font-medium text-sm ${
							comparison.difference < 0
								? "text-green-600"
								: comparison.difference > 0
									? "text-red-600"
									: "text-muted-foreground"
						}`}
					>
						{comparison.status}
					</p>
				</div>
			</div>

			<div className="h-[300px] w-full min-w-0">
				<ChartContainer config={chartConfig}>
					<LineChart
						data={chartData}
						margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
					>
						<CartesianGrid className="stroke-muted" strokeDasharray="3 3" />
						<XAxis
							className="fill-muted-foreground text-xs"
							dataKey="label"
							tick={{ fontSize: 12 }}
						/>
						<YAxis
							className="fill-muted-foreground text-xs"
							tick={{ fontSize: 12 }}
							tickFormatter={(value) =>
								formatCurrency(Number(value), baseCurrency)
							}
						/>
						<ChartTooltip
							content={
								<ChartTooltipContent
									formatter={(value, name, item) => (
										<>
											<div
												className="h-2 w-2 shrink-0 rounded-[2px]"
												style={{ backgroundColor: item.color }}
											/>
											<div className="flex flex-1 items-center justify-between gap-4 leading-none">
												<span className="text-muted-foreground">
													{chartConfig[name as keyof typeof chartConfig]
														?.label || name}
												</span>
												<span className="font-semibold text-foreground tabular-nums">
													{formatCurrency(value as number, baseCurrency)}
												</span>
											</div>
										</>
									)}
								/>
							}
						/>
						<Line
							activeDot={{ r: 6 }}
							dataKey="cumulative"
							dot={{ fill: "var(--color-cumulative)", strokeWidth: 2, r: 4 }}
							name="Cumulative"
							stroke="var(--color-cumulative)"
							strokeWidth={3}
							type="monotone"
						/>
						{totalBudget && (
							<Line
								activeDot={{ r: 4 }}
								dataKey="budgetPace"
								dot={false}
								name="Budget Pace"
								stroke="var(--color-budgetPace)"
								strokeDasharray="8 4"
								strokeWidth={2}
								type="monotone"
							/>
						)}
					</LineChart>
				</ChartContainer>
			</div>
		</div>
	);
}

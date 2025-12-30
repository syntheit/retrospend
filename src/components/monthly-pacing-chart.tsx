"use client";

import { useMemo } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	type TooltipProps,
	XAxis,
	YAxis,
} from "recharts";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import {
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
} from "~/lib/utils";

interface MonthlyPacingChartProps {
	expenses: NormalizedExpense[];
	totalBudget?: number;
	baseCurrency: string;
	liveRateToBaseCurrency: number | null;
}

export function MonthlyPacingChart({
	expenses,
	totalBudget,
	baseCurrency,
	liveRateToBaseCurrency,
}: MonthlyPacingChartProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const chartData = useMemo(() => {
		const now = new Date();
		const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of last month

		// Get expenses for current and last month
		const currentMonthExpenses = expenses.filter(
			(expense) => expense.date >= currentMonth && expense.date <= now,
		);

		const lastMonthExpenses = expenses.filter(
			(expense) => expense.date >= lastMonth && expense.date <= lastMonthEnd,
		);

		// Calculate cumulative spending by day for each month
		const daysInMonth = new Date(
			now.getFullYear(),
			now.getMonth() + 1,
			0,
		).getDate();
		const data = [];

		for (let day = 1; day <= daysInMonth; day++) {
			const currentMonthDay = new Date(now.getFullYear(), now.getMonth(), day);
			const lastMonthDay = new Date(now.getFullYear(), now.getMonth() - 1, day);

			// Current month cumulative
			const currentMonthCumulative = currentMonthExpenses
				.filter((expense) => expense.date <= currentMonthDay)
				.reduce(
					(sum, expense) =>
						sum +
						convertExpenseAmountForDisplay(
							expense,
							baseCurrency,
							liveRateToBaseCurrency,
						),
					0,
				);

			// Last month cumulative (only up to the current day if we're past that day in last month)
			const lastMonthCumulative = lastMonthExpenses
				.filter((expense) => expense.date <= lastMonthDay)
				.reduce(
					(sum, expense) =>
						sum +
						convertExpenseAmountForDisplay(
							expense,
							baseCurrency,
							liveRateToBaseCurrency,
						),
					0,
				);

			// Budget pace (linear from day 1 $0 to day end $totalBudget)
			const budgetPace = totalBudget
				? (totalBudget / daysInMonth) * day
				: undefined;

			data.push({
				day,
				currentMonth: Math.round(currentMonthCumulative * 100) / 100,
				lastMonth: Math.round(lastMonthCumulative * 100) / 100,
				budgetPace: budgetPace ? Math.round(budgetPace * 100) / 100 : undefined,
			});
		}

		return data;
	}, [expenses, baseCurrency, liveRateToBaseCurrency, totalBudget]);

	const comparison = useMemo(() => {
		if (chartData.length === 0) return { status: "No data", difference: 0 };

		const currentDay = new Date().getDate();
		const todayData = chartData.find((d) => d.day === currentDay);

		if (!todayData) return { status: "No data", difference: 0 };

		const difference = todayData.currentMonth - todayData.lastMonth;
		const formattedDifference = formatCurrency(
			Math.abs(difference),
			baseCurrency,
		);
		const status =
			difference < 0
				? `${formattedDifference} under last month's pace`
				: difference > 0
					? `${formattedDifference} over last month's pace`
					: "On track with last month";

		return { status, difference };
	}, [chartData, baseCurrency, formatCurrency]);

	const CustomTooltip = ({
		active,
		payload,
		label,
	}: TooltipProps<number, string>) => {
		if (active && payload && payload.length) {
			return (
				<div className="rounded-lg border border-border bg-background p-3 shadow-md">
					<p className="mb-2 font-medium text-sm">{`Day ${label}`}</p>
					<div className="space-y-1">
						<p className="text-orange-600 text-sm">
							<span className="font-medium">This Month:</span>{" "}
							{formatCurrency(payload[0]?.value || 0, baseCurrency)}
						</p>
						<p className="text-sm text-stone-500">
							<span className="font-medium">Last Month:</span>{" "}
							{formatCurrency(payload[1]?.value || 0, baseCurrency)}
						</p>
						{payload[2]?.value !== undefined && (
							<p className="text-blue-600 text-sm">
								<span className="font-medium">Budget Pace:</span>{" "}
								{formatCurrency(payload[2]?.value || 0, baseCurrency)}
							</p>
						)}
					</div>
				</div>
			);
		}
		return null;
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="font-semibold text-lg">Monthly Pacing</h3>
					<p className="text-muted-foreground text-sm">
						Cumulative spending vs. last month
						{totalBudget ? " and budget pace" : ""}
					</p>
				</div>
				<div className="text-right">
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

			<div className="h-[300px]">
				<ResponsiveContainer height="100%" width="100%">
					<LineChart
						data={chartData}
						margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
					>
						<CartesianGrid className="stroke-muted" strokeDasharray="3 3" />
						<XAxis
							className="fill-muted-foreground text-xs"
							dataKey="day"
							tick={{ fontSize: 12 }}
						/>
						<YAxis
							className="fill-muted-foreground text-xs"
							tick={{ fontSize: 12 }}
							tickFormatter={(value) =>
								formatCurrency(Number(value), baseCurrency)
							}
						/>
						<Tooltip content={<CustomTooltip />} />
						<Line
							activeDot={{ r: 6 }}
							dataKey="currentMonth"
							dot={{ fill: "#ea580c", strokeWidth: 2, r: 4 }} // orange-600
							name="This Month"
							stroke="#ea580c"
							strokeWidth={3}
							type="monotone"
						/>
						<Line
							activeDot={{ r: 5 }}
							dataKey="lastMonth"
							dot={{ fill: "#78716c", strokeWidth: 2, r: 3 }} // stone-500
							name="Last Month"
							stroke="#78716c"
							strokeDasharray="5 5"
							strokeWidth={2}
							type="monotone"
						/>
						{totalBudget && (
							<Line
								activeDot={{ r: 4 }}
								dataKey="budgetPace"
								dot={false} // blue-600
								name="Budget Pace"
								stroke="#2563eb"
								strokeDasharray="8 4"
								strokeWidth={2}
								type="monotone"
							/>
						)}
					</LineChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

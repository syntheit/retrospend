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
import type { NormalizedExpense } from "~/lib/utils";

interface MonthlyPacingChartProps {
	expenses: NormalizedExpense[];
}

export function MonthlyPacingChart({ expenses }: MonthlyPacingChartProps) {
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
					(sum, expense) => sum + (expense.amountInUSD ?? expense.amount),
					0,
				);

			// Last month cumulative (only up to the current day if we're past that day in last month)
			const lastMonthCumulative = lastMonthExpenses
				.filter((expense) => expense.date <= lastMonthDay)
				.reduce(
					(sum, expense) => sum + (expense.amountInUSD ?? expense.amount),
					0,
				);

			data.push({
				day,
				currentMonth: Math.round(currentMonthCumulative * 100) / 100,
				lastMonth: Math.round(lastMonthCumulative * 100) / 100,
			});
		}

		return data;
	}, [expenses]);

	const comparison = useMemo(() => {
		if (chartData.length === 0) return { status: "No data", difference: 0 };

		const currentDay = new Date().getDate();
		const todayData = chartData.find((d) => d.day === currentDay);

		if (!todayData) return { status: "No data", difference: 0 };

		const difference = todayData.currentMonth - todayData.lastMonth;
		const status =
			difference < 0
				? `$${Math.abs(difference).toFixed(2)} under last month's pace`
				: difference > 0
					? `$${difference.toFixed(2)} over last month's pace`
					: "On track with last month";

		return { status, difference };
	}, [chartData]);

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
							<span className="font-medium">This Month:</span> $
							{payload[0]?.value?.toFixed(2)}
						</p>
						<p className="text-sm text-stone-500">
							<span className="font-medium">Last Month:</span> $
							{payload[1]?.value?.toFixed(2)}
						</p>
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
							tickFormatter={(value) => `$${value}`}
						/>
						<Tooltip content={<CustomTooltip />} />
						<Line
							type="monotone"
							dataKey="currentMonth"
							stroke="#ea580c" // orange-600
							strokeWidth={3}
							dot={{ fill: "#ea580c", strokeWidth: 2, r: 4 }}
							activeDot={{ r: 6 }}
							name="This Month"
						/>
						<Line
							type="monotone"
							dataKey="lastMonth"
							stroke="#78716c" // stone-500
							strokeWidth={2}
							strokeDasharray="5 5"
							dot={{ fill: "#78716c", strokeWidth: 2, r: 3 }}
							activeDot={{ r: 5 }}
							name="Last Month"
						/>
					</LineChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

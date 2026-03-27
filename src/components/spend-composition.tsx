"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useAnalyticsCategoryPreferences } from "~/hooks/use-page-settings";
import { formatCurrency } from "~/lib/currency-format";
import {
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
} from "~/lib/utils";

function CustomTooltip({
	active,
	payload,
	baseCurrency,
}: {
	active?: boolean;
	baseCurrency: string;
	payload?: Array<{
		payload: { name: string; value: number; percentage: number };
	}>;
}) {
	if (active && payload && payload.length > 0 && payload[0]) {
		const data = payload[0].payload;
		return (
			<div className="rounded-lg border border-border bg-background p-3 shadow-md">
				<p className="font-medium text-sm">{data.name}</p>
				<p className="text-muted-foreground text-sm">
					{formatCurrency(data.value, baseCurrency)} ({data.percentage}%)
				</p>
			</div>
		);
	}
	return null;
}

interface SpendCompositionProps {
	expenses: NormalizedExpense[];
	baseCurrency: string;
	liveRateToBaseCurrency: number | null;
}

export function SpendComposition({
	expenses,
	baseCurrency,
	liveRateToBaseCurrency,
}: SpendCompositionProps) {
	const { preferenceMap } = useAnalyticsCategoryPreferences();

	// Pre-compute converted amounts once — both chartData and categoryBreakdown read from this
	const convertedExpenses = useMemo(() => {
		return expenses.map((expense) => ({
			expense,
			convertedAmount: convertExpenseAmountForDisplay(
				expense,
				baseCurrency,
				liveRateToBaseCurrency,
			),
		}));
	}, [expenses, baseCurrency, liveRateToBaseCurrency]);

	const chartData = useMemo(() => {
		let fixedExpenses = 0;
		let flexibleExpenses = 0;

		for (const { expense, convertedAmount } of convertedExpenses) {
			const isFixed =
				expense.category?.id &&
				preferenceMap?.[expense.category.id] === false;
			if (isFixed) {
				fixedExpenses += convertedAmount;
			} else {
				flexibleExpenses += convertedAmount;
			}
		}

		const total = fixedExpenses + flexibleExpenses;
		const fixedPercentage =
			total > 0 ? Math.round((fixedExpenses / total) * 100) : 0;
		const flexiblePercentage =
			total > 0 ? Math.round((flexibleExpenses / total) * 100) : 0;

		return [
			{
				name: "Fixed",
				value: Math.round(fixedExpenses * 100) / 100,
				percentage: fixedPercentage,
				color: "#78716c", // stone-500
			},
			{
				name: "Flexible",
				value: Math.round(flexibleExpenses * 100) / 100,
				percentage: flexiblePercentage,
				color: "#ea580c", // orange-600
			},
		];
	}, [convertedExpenses, preferenceMap]);

	const totalSpending = useMemo(() => {
		return chartData.reduce((sum, item) => sum + item.value, 0);
	}, [chartData]);

	const categoryBreakdown = useMemo(() => {
		const fixedCategories = new Map<string, number>();
		const flexibleCategories = new Map<string, number>();

		for (const { expense, convertedAmount } of convertedExpenses) {
			const categoryName = expense.category?.name || "Uncategorized";
			const isFixed =
				expense.category?.id && preferenceMap?.[expense.category.id] === false;

			if (isFixed) {
				fixedCategories.set(
					categoryName,
					(fixedCategories.get(categoryName) || 0) + convertedAmount,
				);
			} else {
				flexibleCategories.set(
					categoryName,
					(flexibleCategories.get(categoryName) || 0) + convertedAmount,
				);
			}
		}

		const fixedTotal = Array.from(fixedCategories.values()).reduce(
			(sum, amount) => sum + amount,
			0,
		);
		const flexibleTotal = Array.from(flexibleCategories.values()).reduce(
			(sum, amount) => sum + amount,
			0,
		);

		const fixedBreakdown = Array.from(fixedCategories.entries())
			.map(([name, amount]) => ({
				name,
				amount: Math.round(amount * 100) / 100,
				percentage:
					fixedTotal > 0 ? Math.round((amount / fixedTotal) * 100) : 0,
			}))
			.sort((a, b) => b.amount - a.amount);

		const flexibleBreakdown = Array.from(flexibleCategories.entries())
			.map(([name, amount]) => ({
				name,
				amount: Math.round(amount * 100) / 100,
				percentage:
					flexibleTotal > 0 ? Math.round((amount / flexibleTotal) * 100) : 0,
			}))
			.sort((a, b) => b.amount - a.amount);

		return {
			fixed: fixedBreakdown,
			flexible: flexibleBreakdown,
			fixedTotal: Math.round(fixedTotal * 100) / 100,
			flexibleTotal: Math.round(flexibleTotal * 100) / 100,
		};
	}, [convertedExpenses, preferenceMap]);

	if (expenses.length === 0) {
		return (
			<div className="space-y-4">
				<div>
					<h3 className="font-semibold text-lg">Spend Composition</h3>
					<p className="text-muted-foreground text-sm">
						Fixed vs. flexible spending
					</p>
				</div>
				<div className="flex h-[220px] sm:h-[300px] items-center justify-center">
					<p className="text-muted-foreground">
						No expenses in selected time range
					</p>
				</div>
			</div>
		);
	}

	if (totalSpending === 0) {
		return (
			<div className="space-y-4">
				<div>
					<h3 className="font-semibold text-lg">Spend Composition</h3>
					<p className="text-muted-foreground text-sm">
						Fixed vs. flexible spending
					</p>
				</div>
				<div className="flex h-[220px] sm:h-[300px] items-center justify-center">
					<p className="text-muted-foreground">
						All expenses have zero amounts
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-w-0 space-y-4">
			<div>
				<h3 className="font-semibold text-lg">Spend Composition</h3>
				<p className="text-muted-foreground text-sm">
					Fixed vs. flexible spending
				</p>
			</div>

			<div className="h-[220px] sm:h-[300px] w-full min-w-0" role="img" aria-label={`Spend composition: Fixed ${chartData[0]?.percentage ?? 0}%, Flexible ${chartData[1]?.percentage ?? 0}%`}>
				<ResponsiveContainer height="100%" width="100%">
					<PieChart>
						<Pie
							cx="50%"
							cy="50%"
							data={chartData}
							dataKey="value"
							innerRadius={60}
							outerRadius={100}
							paddingAngle={2}
						>
							{chartData.map((entry) => (
								<Cell fill={entry.color} key={`cell-${entry.name}`} />
							))}
						</Pie>
						<Tooltip content={<CustomTooltip baseCurrency={baseCurrency} />} />
					</PieChart>
				</ResponsiveContainer>
			</div>

			{/* Legend */}
			<div className="flex justify-center space-x-6 text-sm">
				{chartData.map((item) => (
					<div className="flex items-center space-x-2" key={item.name}>
						<div
							className="h-3 w-3 rounded-full"
							style={{ backgroundColor: item.color }}
						/>
						<span className="text-muted-foreground">
							{item.name}: {item.percentage}%
						</span>
					</div>
				))}
			</div>

			{/* Category Breakdown */}
			<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
				{/* Fixed Categories */}
				<div className="space-y-2">
					<h4 className="font-medium text-sm text-stone-600">
						Fixed Categories
					</h4>
					<div className="space-y-1">
						{categoryBreakdown.fixed.length > 0 ? (
							categoryBreakdown.fixed.slice(0, 5).map((category) => (
								<div
									className="flex justify-between text-xs"
									key={category.name}
								>
									<span className="truncate pr-2 text-muted-foreground">
										{category.name}
									</span>
									<span className="text-muted-foreground">
										{formatCurrency(category.amount, baseCurrency)} ({category.percentage}%)
									</span>
								</div>
							))
						) : (
							<p className="text-muted-foreground text-xs">No fixed expenses</p>
						)}
					</div>
				</div>

				{/* Flexible Categories */}
				<div className="space-y-2">
					<h4 className="font-medium text-orange-600 text-sm">
						Flexible Categories
					</h4>
					<div className="space-y-1">
						{categoryBreakdown.flexible.length > 0 ? (
							categoryBreakdown.flexible.slice(0, 5).map((category) => (
								<div
									className="flex justify-between text-xs"
									key={category.name}
								>
									<span className="truncate pr-2 text-muted-foreground">
										{category.name}
									</span>
									<span className="text-muted-foreground">
										{formatCurrency(category.amount, baseCurrency)} ({category.percentage}%)
									</span>
								</div>
							))
						) : (
							<p className="text-muted-foreground text-xs">
								No flexible expenses
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

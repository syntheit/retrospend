"use client";

import { subMonths } from "date-fns";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	XAxis,
	YAxis,
	Tooltip,
} from "recharts";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { api } from "~/trpc/react";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

const BAR_COLORS = [
	"hsl(var(--chart-1))",
	"hsl(var(--chart-2))",
	"hsl(var(--chart-3))",
];

const MONTH_KEYS = ["twoMonthsAgo", "lastMonth", "thisMonth"] as const;

export default function MonthlyComparisonWidget(_props: WidgetProps) {
	const t = useTranslations("dashboard");
	const { state } = useDashboardContext();
	const { homeCurrency } = useCurrency();
	const { formatCurrency } = useCurrencyFormatter();

	const currentMonth = state.selectedMonth;
	const lastMonth = subMonths(currentMonth, 1);
	const twoMonthsAgo = subMonths(currentMonth, 2);

	const { data: currentData, isLoading: l1 } =
		api.stats.getCategoryBreakdown.useQuery({
			month: currentMonth,
			homeCurrency,
		});

	const { data: lastData, isLoading: l2 } =
		api.stats.getCategoryBreakdown.useQuery({
			month: lastMonth,
			homeCurrency,
		});

	const { data: twoData, isLoading: l3 } =
		api.stats.getCategoryBreakdown.useQuery({
			month: twoMonthsAgo,
			homeCurrency,
		});

	const isLoading = l1 || l2 || l3;

	const chartData = useMemo(() => {
		if (!currentData || !lastData || !twoData) return [];

		// Collect all categories from all months
		const categoryMap = new Map<
			string,
			{ name: string; twoMonthsAgo: number; lastMonth: number; thisMonth: number }
		>();

		for (const item of twoData) {
			categoryMap.set(item.name, {
				name: item.name,
				twoMonthsAgo: item.value,
				lastMonth: 0,
				thisMonth: 0,
			});
		}
		for (const item of lastData) {
			const existing = categoryMap.get(item.name);
			if (existing) {
				existing.lastMonth = item.value;
			} else {
				categoryMap.set(item.name, {
					name: item.name,
					twoMonthsAgo: 0,
					lastMonth: item.value,
					thisMonth: 0,
				});
			}
		}
		for (const item of currentData) {
			const existing = categoryMap.get(item.name);
			if (existing) {
				existing.thisMonth = item.value;
			} else {
				categoryMap.set(item.name, {
					name: item.name,
					twoMonthsAgo: 0,
					lastMonth: 0,
					thisMonth: item.value,
				});
			}
		}

		// Sort by current month value, take top 5
		return Array.from(categoryMap.values())
			.sort((a, b) => b.thisMonth - a.thisMonth)
			.slice(0, 5);
	}, [currentData, lastData, twoData]);

	if (isLoading) {
		return <Skeleton className="h-[200px] w-full rounded-xl" />;
	}

	if (chartData.length === 0) {
		return (
			<div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
				{t("widgets.monthlyComparisonWidget.notEnoughData")}
			</div>
		);
	}

	const monthLabels = [
		twoMonthsAgo.toLocaleString("default", { month: "short" }),
		lastMonth.toLocaleString("default", { month: "short" }),
		currentMonth.toLocaleString("default", { month: "short" }),
	];

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-4">
				{monthLabels.map((label, i) => (
					<div className="flex items-center gap-1.5" key={label}>
						<div
							className="h-2.5 w-2.5 rounded-sm"
							style={{ backgroundColor: BAR_COLORS[i] }}
						/>
						<span className="text-muted-foreground text-xs">{label}</span>
					</div>
				))}
			</div>
			<div className="h-[180px] w-full">
				<ResponsiveContainer height="100%" width="100%">
					<BarChart data={chartData} layout="vertical">
						<CartesianGrid
							horizontal={false}
							strokeDasharray="3 3"
							strokeOpacity={0.15}
						/>
						<XAxis
							axisLine={false}
							fontSize={10}
							tickFormatter={(v: number) =>
								formatCurrency(v, homeCurrency)
							}
							tickLine={false}
							type="number"
						/>
						<YAxis
							axisLine={false}
							dataKey="name"
							fontSize={11}
							tickLine={false}
							type="category"
							width={80}
						/>
						<Tooltip
							content={({ payload, label }) => {
								if (!payload?.length) return null;
								return (
									<div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
										<div className="mb-1 font-medium text-sm">{label}</div>
										{payload.map((entry) => (
											<div
												className="flex items-center gap-2 text-xs"
												key={entry.name}
											>
												<div
													className="h-2 w-2 rounded-sm"
													style={{ backgroundColor: entry.color }}
												/>
												<span className="text-muted-foreground">
													{entry.name === "twoMonthsAgo"
														? monthLabels[0]
														: entry.name === "lastMonth"
															? monthLabels[1]
															: monthLabels[2]}
												</span>
												<span className="ml-auto font-medium tabular-nums">
													{formatCurrency(
														entry.value as number,
														homeCurrency,
													)}
												</span>
											</div>
										))}
									</div>
								);
							}}
						/>
						{MONTH_KEYS.map((key, i) => (
							<Bar
								barSize={6}
								dataKey={key}
								fill={BAR_COLORS[i]}
								key={key}
								radius={[0, 3, 3, 0]}
							/>
						))}
					</BarChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

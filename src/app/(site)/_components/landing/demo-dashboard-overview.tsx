"use client";

import {
	CalendarDays,
	DollarSign,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { useState } from "react";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { BudgetPacingChart } from "~/app/(dashboard)/_components/budget-pacing-chart";
import { CategoryDonut } from "~/app/(dashboard)/_components/category-donut";
import type { CategorySegment } from "~/app/(dashboard)/_components/category-donut-legend";
import { RecentExpenses } from "~/app/(dashboard)/_components/recent-expenses";
import { StatCard } from "~/components/ui/stat-card";
import { formatCurrency } from "~/lib/currency-format";
import {
	DEMO_CATEGORY_BREAKDOWN,
	DEMO_CHART_CONFIG,
	DEMO_DAILY_TREND,
	DEMO_PIE_CHART_CONFIG,
	DEMO_RECENT_ACTIVITY,
	DEMO_STAT_CARDS,
} from "./demo-data";

function DemoFormatCurrency(amount: number, currency = "USD") {
	return formatCurrency(amount, currency);
}

export function DemoDashboardOverview() {
	const [activeSliceIndex, setActiveSliceIndex] = useState<number | null>(null);
	const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
		new Set(),
	);

	const visibleBreakdown = DEMO_CATEGORY_BREAKDOWN.filter(
		(s) => !s.categoryId || !hiddenCategories.has(s.categoryId),
	);
	const visibleTotal = visibleBreakdown.reduce((sum, s) => sum + s.value, 0);
	const activeSlice =
		activeSliceIndex !== null ? visibleBreakdown[activeSliceIndex] : null;

	const handleCategoryClick = (segment: CategorySegment) => {
		if (!segment.categoryId) return;
		setHiddenCategories((prev) => {
			const next = new Set(prev);
			if (next.has(segment.categoryId!)) {
				next.delete(segment.categoryId!);
			} else {
				next.add(segment.categoryId!);
			}
			return next;
		});
		setActiveSliceIndex(null);
	};

	return (
		<div className="space-y-6">
			{/* Stat Cards Row */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<StatCard
					icon={DollarSign}
					title="Total This Month"
					trend={{
						value: DEMO_STAT_CARDS.changeVsLastMonth,
						label: "vs last month",
						intent: "positive",
					}}
					value={formatCurrency(DEMO_STAT_CARDS.totalThisMonth)}
					variant="blue"
				/>
				<StatCard
					icon={CalendarDays}
					title="Daily Average"
					value={formatCurrency(DEMO_STAT_CARDS.dailyAverage)}
					variant="cyan"
				/>
				<StatCard
					icon={TrendingUp}
					title="Projected Spend"
					value={formatCurrency(DEMO_STAT_CARDS.projectedSpend)}
					variant="violet"
				/>
				<StatCard
					description="4 categories under budget"
					icon={TrendingDown}
					title="Budget Status"
					value="On Track"
					variant="emerald"
				/>
			</div>

			{/* Chart + Donut Grid */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
				<div className="space-y-6 lg:col-span-7">
					<div className="h-[350px]">
						<BudgetPacingChart
							chartConfig={DEMO_CHART_CONFIG}
							currentDay={15}
							dailyTrend={DEMO_DAILY_TREND}
							daysInMonth={31}
							expensesLoading={false}
							homeCurrency="USD"
							variableBudget={3200}
							variableSpent={1920}
						/>
					</div>

					<div className="[&>*]:!h-auto">
						<RecentExpenses
							activityLoading={false}
							formatCurrency={DemoFormatCurrency}
							homeCurrency="USD"
							liveRateToBaseCurrency={null}
							recentActivity={DEMO_RECENT_ACTIVITY}
						/>
					</div>
				</div>

				<div className="lg:col-span-5">
					<CategoryDonut
						activeSlice={activeSlice}
						activeSliceIndex={activeSliceIndex}
						categoryBreakdown={DEMO_CATEGORY_BREAKDOWN}
						categoryClickBehavior="toggle"
						expensesLoading={false}
						formatMoney={(v: number) => formatCurrency(v, "USD")}
						handleCategoryClick={handleCategoryClick}
						handleSliceEnter={(_data: PieSectorDataItem, index: number) =>
							setActiveSliceIndex(index)
						}
						handleSliceLeave={() => setActiveSliceIndex(null)}
						hiddenCategories={hiddenCategories}
						isUsingMockExpenses={false}
						layout="vertical"
						pieChartConfig={DEMO_PIE_CHART_CONFIG}
						visibleCategoryBreakdown={visibleBreakdown}
						visibleTotal={visibleTotal}
					/>
				</div>
			</div>
		</div>
	);
}

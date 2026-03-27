"use client";

import { Briefcase, Calendar, Clock, Wallet } from "lucide-react";
import { StatCard } from "~/components/ui/stat-card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

import type { RouterOutputs } from "~/trpc/react";

interface StatsCardsProps {
	expensesLoading: boolean;
	overviewStats?: RouterOutputs["dashboard"]["getOverviewStats"];
	totalThisMonth: number;
	changeVsLastMonth: number | null;
	dailyAverage: number;
	projectedSpend: number;
	categoryBreakdown: Array<{
		name: string;
		value: number;
	}>;
	homeCurrency: string;
	budgetPacing?: {
		totalBudget: number;
		totalSpent: number;
		daysInMonth: number;
		currentDay: number;
	};
}

export function StatsCards({
	expensesLoading,
	overviewStats,
	totalThisMonth,
	changeVsLastMonth,
	dailyAverage,
	projectedSpend,
	categoryBreakdown,
	homeCurrency,
	budgetPacing,
}: StatsCardsProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const formatMoney = (value: number) => formatCurrency(value, homeCurrency);
	const isPositiveChange = changeVsLastMonth !== null && changeVsLastMonth >= 0;

	// Calculate budget usage percentage
	const budgetUsagePct =
		overviewStats?.dailyBudgetPace.totalBudget &&
		overviewStats.dailyBudgetPace.totalBudget > 0
			? (overviewStats.dailyBudgetPace.totalSpent /
					overviewStats.dailyBudgetPace.totalBudget) *
				100
			: 0;

	// Calculate pace projection: at current rate, where will we end up?
	const paceProjection =
		budgetPacing &&
		budgetPacing.totalBudget > 0 &&
		budgetPacing.currentDay > 0
			? (budgetPacing.totalSpent / budgetPacing.currentDay) *
				budgetPacing.daysInMonth
			: null;

	const paceVsBudget =
		paceProjection !== null && budgetPacing
			? paceProjection - budgetPacing.totalBudget
			: null;

	// Green: projected < 90%, Amber: 90-100%, Red: > 100%
	const budgetCardVariant = (() => {
		if (!paceProjection || !budgetPacing?.totalBudget) {
			return budgetUsagePct > 80 ? "amber" : "blue";
		}
		const ratio = paceProjection / budgetPacing.totalBudget;
		if (ratio > 1) return "rose";
		if (ratio > 0.9) return "amber";
		return "emerald";
	})();

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{/* Hero Card - Total Monthly Spending */}
			<StatCard
				description={
					!expensesLoading && dailyAverage > 0 ? (
						<>
							Avg:{" "}
							<span className="font-medium text-foreground">
								{formatMoney(dailyAverage)}/day
							</span>
						</>
					) : null
				}
				icon={Wallet}
				loading={expensesLoading}
				title="Total This Month"
				trend={
					expensesLoading
						? undefined
						: {
								value: changeVsLastMonth,
								label: "vs last month",
								intent: isPositiveChange ? "negative" : "positive",
							}
				}
				value={expensesLoading ? undefined : formatMoney(totalThisMonth)}
				variant="neutral"
			/>

			{/* Last 24 Hours / Month Total */}
			{overviewStats?.isCurrentMonth !== false ? (
				<StatCard
					formatCurrency={formatCurrency}
					icon={Clock}
					loading={expensesLoading}
					title="Last 24 Hours"
					trend={
						!expensesLoading &&
						overviewStats &&
						dailyAverage > 0 &&
						overviewStats.last24Hours !== dailyAverage
							? {
									value: overviewStats.last24Hours - dailyAverage,
									label: "vs daily avg",
									isMoney: true,
									intent:
										overviewStats.last24Hours > dailyAverage
											? "negative"
											: "positive",
									forceNeutral: true,
								}
							: undefined
					}
					value={
						expensesLoading
							? undefined
							: formatMoney(overviewStats?.last24Hours ?? 0)
					}
					variant="blue"
				/>
			) : (
				<StatCard
					description="Final spend for this month"
					icon={Calendar}
					loading={expensesLoading}
					title="Month Total"
					value={
						expensesLoading
							? undefined
							: formatMoney(overviewStats?.monthTotal ?? 0)
					}
					variant="cyan"
				/>
			)}

			{/* Work Equivalent / Top Category */}
			{overviewStats?.workEquivalent.monthlyIncome &&
			overviewStats.workEquivalent.monthlyIncome > 0 ? (
				<StatCard
					description="Time cost of this month"
					icon={Briefcase}
					loading={expensesLoading}
					title="Work Equivalent"
					value={
						expensesLoading
							? undefined
							: `${Math.round(
									(overviewStats.workEquivalent.totalSpent /
										overviewStats.workEquivalent.monthlyIncome) *
										160,
								)}h`
					}
					variant="violet"
				/>
			) : (
				<StatCard
					description={
						!expensesLoading &&
						categoryBreakdown.length > 0 &&
						formatMoney(categoryBreakdown[0]?.value ?? 0)
					}
					icon={Briefcase}
					loading={expensesLoading}
					title="Top Category"
					value={
						expensesLoading
							? undefined
							: categoryBreakdown.length > 0
								? categoryBreakdown[0]?.name
								: "No expenses"
					}
					variant="violet"
				/>
			)}

			{/* Budget Used / Projected */}
			{overviewStats?.dailyBudgetPace.totalBudget &&
			overviewStats.dailyBudgetPace.totalBudget > 0 ? (
				<StatCard
					description={
						!expensesLoading && (
							<>
								{formatMoney(overviewStats.dailyBudgetPace.totalSpent)} of{" "}
								{formatMoney(overviewStats.dailyBudgetPace.totalBudget)}
							</>
						)
					}
					formatCurrency={formatMoney}
					icon={Wallet}
					loading={expensesLoading}
					title="Budget Used"
					trend={
						!expensesLoading && paceVsBudget !== null
							? {
									value: paceVsBudget,
									label: paceVsBudget > 0 ? "over budget" : "under budget",
									isMoney: true,
									intent: paceVsBudget > 0 ? "negative" : "positive",
								}
							: undefined
					}
					value={expensesLoading ? undefined : `${Math.round(budgetUsagePct)}%`}
					variant={budgetCardVariant}
				/>
			) : (
				<StatCard
					description="Last 3 months average"
					icon={Wallet}
					loading={expensesLoading}
					title="Projected Total"
					value={expensesLoading ? undefined : formatMoney(projectedSpend)}
					variant="emerald"
				/>
			)}
		</div>
	);
}

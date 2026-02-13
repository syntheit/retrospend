"use client";

import {
	Briefcase,
	Calendar,
	Clock,
	Wallet,
} from "lucide-react";
import { StatCard } from "~/components/ui/stat-card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";

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

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{/* Hero Card - Total Monthly Spending */}
			<StatCard
				description={
					!expensesLoading && dailyAverage > 0 ? (
						<>
							Avg:{" "}
							<span className="font-medium text-white">
								{formatMoney(dailyAverage)}/day
							</span>
						</>
					) : null
				}
				icon={Wallet}
				loading={expensesLoading}
				variant="neutral"
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
			/>

			{/* Last 24 Hours / Month Total */}
			{overviewStats?.isCurrentMonth !== false ? (
				<StatCard
					formatCurrency={formatCurrency}
					icon={Clock}
					loading={expensesLoading}
					variant="blue"
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
				/>
			) : (
				<StatCard
					description="Final spend for this month"
					icon={Calendar}
					loading={expensesLoading}
					variant="cyan"
					title="Month Total"
					value={
						expensesLoading
							? undefined
							: formatMoney(overviewStats?.monthTotal ?? 0)
					}
				/>
			)}

			{/* Work Equivalent / Top Category */}
			{overviewStats?.workEquivalent.monthlyIncome &&
			overviewStats.workEquivalent.monthlyIncome > 0 ? (
				<StatCard
					description="Time cost of this month"
					icon={Briefcase}
					loading={expensesLoading}
					variant="violet"
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
					variant="violet"
					title="Top Category"
					value={
						expensesLoading
							? undefined
							: categoryBreakdown.length > 0
								? categoryBreakdown[0]?.name
								: "No expenses"
					}
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
					icon={Wallet}
					loading={expensesLoading}
					variant={budgetUsagePct > 80 ? "amber" : "blue"}
					title="Budget Used"
					value={expensesLoading ? undefined : `${Math.round(budgetUsagePct)}%`}
				/>
			) : (
				<StatCard
					description="Last 3 months average"
					icon={Wallet}
					loading={expensesLoading}
					variant="blue"
					title="Projected Total"
					value={expensesLoading ? undefined : formatMoney(projectedSpend)}
				/>
			)}
		</div>
	);
}

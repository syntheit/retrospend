"use client";

import { Briefcase, Calendar, Clock, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatCard } from "~/components/ui/stat-card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { budgetStanding, budgetStandingVariant } from "~/lib/budget-standing";

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
	const t = useTranslations("stats");
	const { formatCurrency } = useCurrencyFormatter();
	const formatMoney = (value: number) => formatCurrency(value, homeCurrency);
	const isPositiveChange = changeVsLastMonth !== null && changeVsLastMonth >= 0;

	// Actual use of the budget so far; the pace only colors the card
	const standing = budgetStanding({
		totalBudget: overviewStats?.dailyBudgetPace.totalBudget ?? 0,
		totalSpent: overviewStats?.dailyBudgetPace.totalSpent ?? 0,
		currentDay: budgetPacing?.currentDay ?? 0,
		daysInMonth: budgetPacing?.daysInMonth ?? 0,
	});

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{/* Hero Card - Total Monthly Spending */}
			<StatCard
				description={
					!expensesLoading && dailyAverage > 0 ? (
						<>
							{t("avgPerDay", { amount: formatMoney(dailyAverage) })}
						</>
					) : null
				}
				icon={Wallet}
				loading={expensesLoading}
				title={t("totalThisMonth")}
				trend={
					expensesLoading
						? undefined
						: {
								value: changeVsLastMonth,
								label: t("vsLastMonth"),
								intent: isPositiveChange ? "negative" : "positive",
							}
				}
				value={expensesLoading ? undefined : formatMoney(totalThisMonth)}
				variant="neutral"
			/>

			{/* Last 24 Hours / Month Total */}
			{overviewStats?.isCurrentMonth !== false ? (
				<StatCard
					formatMoney={formatMoney}
					icon={Clock}
					loading={expensesLoading}
					title={t("last24Hours")}
					trend={
						!expensesLoading &&
						overviewStats &&
						dailyAverage > 0 &&
						overviewStats.last24Hours !== dailyAverage
							? {
									value: overviewStats.last24Hours - dailyAverage,
									label: t("vsDailyAvg"),
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
					description={t("finalSpend")}
					icon={Calendar}
					loading={expensesLoading}
					title={t("monthTotal")}
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
					description={t("timeCost")}
					icon={Briefcase}
					loading={expensesLoading}
					title={t("workEquivalent")}
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
					title={t("topCategory")}
					value={
						expensesLoading
							? undefined
							: categoryBreakdown.length > 0
								? categoryBreakdown[0]?.name
								: t("noExpenses")
					}
					variant="violet"
				/>
			)}

			{/* Budget Used / Projected */}
			{overviewStats && standing ? (
				<StatCard
					description={
						!expensesLoading && (
							<>
								{t("ofBudget", {
									spent: formatMoney(overviewStats.dailyBudgetPace.totalSpent),
									total: formatMoney(overviewStats.dailyBudgetPace.totalBudget),
								})}
							</>
						)
					}
					formatMoney={formatMoney}
					icon={Wallet}
					loading={expensesLoading}
					title={t("budgetUsed")}
					trend={
						!expensesLoading && standing.difference !== 0
							? {
									value: standing.difference,
									label:
										standing.difference > 0
											? t("overBudget")
											: t("underBudget"),
									isMoney: true,
									intent: standing.difference > 0 ? "negative" : "positive",
								}
							: undefined
					}
					value={
						expensesLoading ? undefined : `${Math.round(standing.usedPct)}%`
					}
					variant={budgetStandingVariant(standing)}
				/>
			) : (
				<StatCard
					description={t("last3MonthsAvg")}
					icon={Wallet}
					loading={expensesLoading}
					title={t("projectedTotal")}
					value={expensesLoading ? undefined : formatMoney(projectedSpend)}
					variant="emerald"
				/>
			)}
		</div>
	);
}

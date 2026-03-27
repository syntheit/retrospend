"use client";

import { CreditCard, Landmark, PlaneTakeoff, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { StatCard } from "~/components/ui/stat-card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { formatPercent } from "~/lib/currency-format";
import { maskAmount } from "~/lib/masking";

interface NetWorthSummaryProps {
	totalNetWorth: number;
	totalAssets: number;
	totalLiabilities: number;
	totalLiquidAssets: number;
	weightedAPR: number;
	homeCurrency: string;
	isPrivacyMode?: boolean;
	averageMonthlySpend?: number;
	netWorth30DaysAgo?: number;
}

export function NetWorthSummary({
	totalNetWorth,
	totalAssets,
	totalLiabilities,
	totalLiquidAssets,
	weightedAPR,
	homeCurrency,
	isPrivacyMode = false,
	averageMonthlySpend,
	netWorth30DaysAgo = 0,
}: NetWorthSummaryProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const isZeroState = useMemo(
		() => totalNetWorth === 0 && totalAssets === 0 && totalLiabilities === 0,
		[totalNetWorth, totalAssets, totalLiabilities],
	);

	const absoluteChange = totalNetWorth - netWorth30DaysAgo;
	const percentChange =
		netWorth30DaysAgo === 0
			? absoluteChange === 0
				? 0
				: 100
			: (absoluteChange / Math.abs(netWorth30DaysAgo)) * 100;

	const isPositive = absoluteChange >= 0;
	const trendColor = isPositive ? "text-emerald-500" : "text-red-500";
	const trendSign = isPositive ? "+" : "";

	const netWorthTrend = (
		<div className="mt-1 flex items-center gap-1.5 font-medium text-sm">
			{isPrivacyMode ? (
				<span className="text-muted-foreground">••••••</span>
			) : (
				<span className={trendColor}>
					{trendSign}
					{formatCurrency(Math.abs(absoluteChange), homeCurrency)} ({trendSign}
					{formatPercent(percentChange)})
				</span>
			)}
			<span className="font-normal text-muted-foreground">past 30 days</span>
		</div>
	);

	const runwayMonths = useMemo(() => {
		if (totalLiquidAssets === 0) return 0;
		if (!averageMonthlySpend || averageMonthlySpend === 0) return Infinity;
		return totalLiquidAssets / averageMonthlySpend;
	}, [totalLiquidAssets, averageMonthlySpend]);

	const runwayValueMasked = useMemo(() => {
		if (isPrivacyMode) return "••••••";
		if (runwayMonths === Infinity || runwayMonths > 1200) return ">100 years";

		const totalMonths = Math.round(runwayMonths);
		if (totalMonths <= 0) return "0 months";

		const years = Math.floor(totalMonths / 12);
		const months = totalMonths % 12;

		const parts = [];
		if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
		if (months > 0)
			parts.push(`${months} ${months === 1 ? "month" : "months"}`);

		return parts.join(" and ");
	}, [runwayMonths, isPrivacyMode]);
	const runwayTooltipText = isPrivacyMode
		? "••••••"
		: `${formatCurrency(averageMonthlySpend ?? 0, homeCurrency)}`;

	if (isZeroState) {
		return (
			<Card className="border-dashed">
				<CardContent className="p-0">
					<EmptyState
						description="Add your first asset or liability to start tracking your net worth."
						icon={TrendingUp}
						title="No Wealth Data Yet"
					/>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{/* Total Net Worth Card */}
			<StatCard
				description={`Liquid: ${isPrivacyMode ? maskAmount(totalLiquidAssets) : formatCurrency(totalLiquidAssets, homeCurrency)}`}
				icon={Landmark}
				subValue={netWorthTrend}
				title="Net Worth"
				value={
					isPrivacyMode
						? maskAmount(totalNetWorth)
						: formatCurrency(totalNetWorth, homeCurrency)
				}
				variant="emerald"
			/>

			{/* Total Assets Card */}
			<StatCard
				icon={TrendingUp}
				title="Total Assets"
				value={
					isPrivacyMode
						? maskAmount(totalAssets)
						: formatCurrency(totalAssets, homeCurrency)
				}
				variant="blue"
			/>

			{/* Total Liabilities Card */}
			<StatCard
				description={
					totalLiabilities > 0 && weightedAPR > 0
						? `Weighted APR: ${formatPercent(weightedAPR)}`
						: undefined
				}
				icon={CreditCard}
				title="Total Liabilities"
				value={
					isPrivacyMode
						? maskAmount(totalLiabilities)
						: formatCurrency(totalLiabilities, homeCurrency)
				}
				variant={totalLiabilities === 0 ? "neutral" : "amber"}
			/>

			{/* Financial Runway Card */}
			<StatCard
				description={`Avg Spend: ${runwayTooltipText}/mo`}
				icon={PlaneTakeoff}
				title="Financial Runway"
				value={runwayValueMasked}
				variant="violet"
			/>
		</div>
	);
}

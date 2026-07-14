"use client";

import { CreditCard, Landmark, PlaneTakeoff, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
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
	const t = useTranslations("wealth");
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
			<span className="font-normal text-muted-foreground">{t("past30Days")}</span>
		</div>
	);

	const runwayMonths = useMemo(() => {
		if (totalLiquidAssets === 0) return 0;
		if (!averageMonthlySpend || averageMonthlySpend === 0) return Infinity;
		return totalLiquidAssets / averageMonthlySpend;
	}, [totalLiquidAssets, averageMonthlySpend]);

	const runwayValueMasked = useMemo(() => {
		if (isPrivacyMode) return "••••••";
		if (runwayMonths === Infinity || runwayMonths > 1200) return t("moreThan100Years");

		const totalMonths = Math.round(runwayMonths);
		if (totalMonths <= 0) return t("zeroMonths");

		const years = Math.floor(totalMonths / 12);
		const months = totalMonths % 12;

		const parts = [];
		if (years > 0) parts.push(t("yearsCount", { count: years }));
		if (months > 0)
			parts.push(t("monthsCount", { count: months }));

		return parts.join(` ${t("and")} `);
	}, [runwayMonths, isPrivacyMode]);
	const runwayTooltipText = isPrivacyMode
		? "••••••"
		: `${formatCurrency(averageMonthlySpend ?? 0, homeCurrency)}`;

	if (isZeroState) {
		return (
			<Card className="border-dashed">
				<CardContent className="p-0">
					<EmptyState
						description={t("noWealthDataDescription")}
						icon={TrendingUp}
						title={t("noWealthDataTitle")}
					/>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{/* Total Net Worth Card */}
			<StatCard
				description={`${t("liquidLabel")}: ${isPrivacyMode ? maskAmount(totalLiquidAssets) : formatCurrency(totalLiquidAssets, homeCurrency)}`}
				icon={Landmark}
				subValue={netWorthTrend}
				title={t("netWorth")}
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
				title={t("totalAssets")}
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
						? `${t("weightedAPR")}: ${formatPercent(weightedAPR)}`
						: undefined
				}
				icon={CreditCard}
				title={t("totalLiabilities")}
				value={
					isPrivacyMode
						? maskAmount(totalLiabilities)
						: formatCurrency(totalLiabilities, homeCurrency)
				}
				variant={totalLiabilities === 0 ? "neutral" : "amber"}
			/>

			{/* Financial Runway Card */}
			<StatCard
				description={`${t("avgSpend")}: ${runwayTooltipText}/${t("moAbbrev")}`}
				icon={PlaneTakeoff}
				title={t("financialRunway")}
				value={runwayValueMasked}
				variant="violet"
			/>
		</div>
	);
}

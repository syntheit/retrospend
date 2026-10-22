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
import { netWorthChange, netWorthPercentChange } from "~/lib/wealth-stats";

interface NetWorthSummaryProps {
	totalNetWorth: number;
	totalAssets: number;
	totalLiabilities: number;
	totalLiquidAssets: number;
	weightedAPR: number;
	homeCurrency: string;
	isPrivacyMode?: boolean;
	averageMonthlySpend?: number;
	/** Null or missing when there is no history 30 days back. */
	netWorth30DaysAgo?: number | null;
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
	netWorth30DaysAgo = null,
}: NetWorthSummaryProps) {
	const t = useTranslations("wealth");
	const { formatCurrency } = useCurrencyFormatter();

	const isZeroState = useMemo(
		() => totalNetWorth === 0 && totalAssets === 0 && totalLiabilities === 0,
		[totalNetWorth, totalAssets, totalLiabilities],
	);

	// No change without a baseline 30 days ago, and no percent when it was 0.
	const absoluteChange = netWorthChange(totalNetWorth, netWorth30DaysAgo);
	const percentChange = netWorthPercentChange(totalNetWorth, netWorth30DaysAgo);

	const isPositive = (absoluteChange ?? 0) >= 0;
	const trendColor = isPositive ? "text-emerald-500" : "text-red-500";
	const trendSign = isPositive ? "+" : "";

	const netWorthTrend =
		absoluteChange === null ? undefined : (
			<div className="mt-1 flex items-center gap-1.5 font-medium text-sm">
				{isPrivacyMode ? (
					<span className="text-muted-foreground">••••••</span>
				) : (
					<span className={trendColor}>
						{formatCurrency(absoluteChange, homeCurrency, "exceptZero")}
						{percentChange !== null &&
							` (${trendSign}${formatPercent(percentChange)})`}
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

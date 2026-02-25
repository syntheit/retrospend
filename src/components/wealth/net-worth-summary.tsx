"use client";

import { CreditCard, Landmark, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { StatCard } from "~/components/ui/stat-card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { maskAmount } from "~/lib/masking";

interface NetWorthSummaryProps {
	totalNetWorth: number;
	totalAssets: number;
	totalLiabilities: number;
	totalLiquidAssets: number;
	weightedAPR: number;
	homeCurrency: string;
	isPrivacyMode?: boolean;
}

export function NetWorthSummary({
	totalNetWorth,
	totalAssets,
	totalLiabilities,
	totalLiquidAssets,
	weightedAPR,
	homeCurrency,
	isPrivacyMode = false,
}: NetWorthSummaryProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const isZeroState = useMemo(
		() => totalNetWorth === 0 && totalAssets === 0 && totalLiabilities === 0,
		[totalNetWorth, totalAssets, totalLiabilities],
	);

	if (isZeroState) {
		return (
			<Card className="border-dashed">
				<CardContent className="flex flex-col items-center justify-center py-12">
					<TrendingUp className="h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-foreground text-lg">
						No wealth data yet
					</h3>
					<p className="mt-2 text-center text-muted-foreground text-sm">
						Add your first asset or liability to start tracking your net worth.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-3">
			{/* Total Net Worth Card */}
			<StatCard
				description={`Liquid: ${isPrivacyMode ? maskAmount(totalLiquidAssets) : formatCurrency(totalLiquidAssets, homeCurrency)}`}
				icon={Landmark}
				title="NET WORTH"
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
				title="TOTAL ASSETS"
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
						? `Weighted APR: ${weightedAPR.toFixed(1)}%`
						: undefined
				}
				icon={CreditCard}
				title="TOTAL LIABILITIES"
				value={
					isPrivacyMode
						? maskAmount(totalLiabilities)
						: formatCurrency(totalLiabilities, homeCurrency)
				}
				variant={totalLiabilities === 0 ? "neutral" : "amber"}
			/>
		</div>
	);
}

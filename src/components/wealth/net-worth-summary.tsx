"use client";

import {
	CreditCard,
	Droplets,
	Percent,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { SummaryCard } from "./summary-card";

interface NetWorthSummaryProps {
	totalNetWorth: number;
	totalAssets: number;
	totalLiabilities: number;
	totalLiquidAssets: number;
	weightedAPR: number;
	homeCurrency: string;
}

export function NetWorthSummary({
	totalNetWorth,
	totalAssets,
	totalLiabilities,
	totalLiquidAssets,
	weightedAPR,
	homeCurrency,
}: NetWorthSummaryProps) {
	const { formatCurrency } = useCurrencyFormatter();

	// Empty state for when there's no wealth data
	if (totalNetWorth === 0 && totalAssets === 0 && totalLiabilities === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<TrendingUp className="h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-lg">No wealth data yet</h3>
					<p className="mt-2 text-center text-muted-foreground text-sm">
						Add your first asset or liability to start tracking your net worth.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-3">
			<SummaryCard
				currency={homeCurrency}
				footer={
					<>
						<Wallet className="h-4 w-4 text-stone-300" />
						<span className="font-medium text-stone-300 text-xs">
							Liquid: {formatCurrency(totalLiquidAssets, homeCurrency)}
						</span>
					</>
				}
				title="Total Net Worth"
				value={totalNetWorth}
				variant="default"
			/>

			<SummaryCard
				currency={homeCurrency}
				footer={
					<>
						<Droplets className="h-3.5 w-3.5" />
						<span>
							Liquid: {formatCurrency(totalLiquidAssets, homeCurrency)}
						</span>
					</>
				}
				icon={TrendingUp}
				title="Total Assets"
				value={totalAssets}
				variant="success"
			/>

			<SummaryCard
				currency={homeCurrency}
				footer={
					<>
						<Percent className="h-3.5 w-3.5" />
						<span>
							Weighted APR:{" "}
							{weightedAPR > 0 ? `${weightedAPR.toFixed(1)}%` : "N/A"}
						</span>
					</>
				}
				icon={CreditCard}
				title="Total Liabilities"
				value={totalLiabilities}
				variant="danger"
			/>
		</div>
	);
}

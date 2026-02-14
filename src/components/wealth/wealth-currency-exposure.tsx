"use client";

import { BarChart3 } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";

interface WealthCurrencyExposureProps {
	assets: {
		currency: string;
		balanceInUSD: number;
	}[];
	totalNetWorth: number;
}

export function WealthCurrencyExposure({
	assets,
	totalNetWorth,
}: WealthCurrencyExposureProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const data = useMemo(() => {
		const exposure = assets.reduce(
			(acc, curr) => {
				acc[curr.currency] = (acc[curr.currency] || 0) + curr.balanceInUSD;
				return acc;
			},
			{} as Record<string, number>,
		);

		return Object.entries(exposure)
			.map(([currency, value]) => ({
				currency,
				value,
				percentage: totalNetWorth > 0 ? (value / totalNetWorth) * 100 : 0,
			}))
			.sort((a, b) => b.value - a.value);
	}, [assets, totalNetWorth]);

	// Empty state
	if (data.length === 0 || totalNetWorth === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Currency Exposure</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<BarChart3 className="h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-lg">No currency data</h3>
					<p className="mt-2 text-center text-muted-foreground text-sm">
						Add assets in different currencies to see exposure breakdown.
					</p>
				</CardContent>
			</Card>
		);
	}

	// Vibrant color ramp for progress bars
	const getBarColor = (index: number) => {
		const colors = [
			"bg-blue-500",
			"bg-violet-500",
			"bg-amber-500",
			"bg-emerald-500",
			"bg-rose-500",
			"bg-cyan-500",
			"bg-orange-500",
		];
		return colors[index % colors.length];
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>Currency Exposure</CardTitle>
				<Badge className="text-xs" variant="outline">
					Base: USD
				</Badge>
			</CardHeader>
			<CardContent className="space-y-4">
				{data.map((item, index) => (
					<div className="space-y-1" key={item.currency}>
						<div className="flex items-center justify-between text-sm">
							<div className="flex items-center gap-2">
								<CurrencyFlag className="!h-4 !w-4" currencyCode={item.currency} />
								<span className="font-medium">{item.currency}</span>
							</div>
							<span className="text-muted-foreground tabular-nums">
								{item.percentage.toFixed(1)}% (
								{formatCurrency(item.value, "USD")})
							</span>
						</div>
						<div className="h-2 w-full overflow-hidden rounded-full bg-secondary/30">
							<div
								className={cn(
									"h-full rounded-full transition-all",
									getBarColor(index),
								)}
								style={{ width: `${item.percentage}%` }}
							/>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

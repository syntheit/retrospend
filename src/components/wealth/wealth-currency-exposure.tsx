"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

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

	return (
		<Card>
			<CardHeader>
				<CardTitle>Currency Exposure</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{data.map((item) => (
					<div className="space-y-1" key={item.currency}>
						<div className="flex items-center justify-between text-sm">
							<span className="font-medium">{item.currency}</span>
							<span className="text-muted-foreground">
								{item.percentage.toFixed(1)}% (
								{formatCurrency(item.value, "USD")})
							</span>
						</div>
						<div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
							<div
								className="h-full bg-primary transition-all"
								style={{ width: `${item.percentage}%` }}
							/>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

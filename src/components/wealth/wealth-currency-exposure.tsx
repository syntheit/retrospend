"use client";

import { BarChart3 } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { maskAmount } from "~/lib/masking";
import { cn } from "~/lib/utils";

interface WealthCurrencyExposureProps {
	assets: {
		currency: string;
		balanceInUSD: number;
		type: string;
	}[];
	isPrivacyMode?: boolean;
}

export function WealthCurrencyExposure({
	assets,
	isPrivacyMode = false,
}: WealthCurrencyExposureProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const data = useMemo(() => {
		// Liabilities reduce their currency's exposure rather than inflating it
		const exposure = assets.reduce(
			(acc, curr) => {
				const isLiability = curr.type.startsWith("LIABILITY_");
				const value = isLiability ? -curr.balanceInUSD : curr.balanceInUSD;
				acc[curr.currency] = (acc[curr.currency] || 0) + value;
				return acc;
			},
			{} as Record<string, number>,
		);

		const total = Object.values(exposure).reduce((sum, v) => sum + v, 0);

		return Object.entries(exposure)
			.map(([currency, value]) => ({
				currency,
				value,
				percentage: total > 0 ? (value / total) * 100 : 0,
			}))
			.sort((a, b) => b.value - a.value);
	}, [assets]);

	// Empty state
	if (data.length === 0 || assets.length === 0) {
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
		<Card className="flex flex-col">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between gap-2">
					<CardTitle>Currency Exposure</CardTitle>
					<Badge className="text-xs" variant="outline">
						Base: USD
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{data.map((item, index) => (
					<div className="space-y-1.5" key={item.currency}>
						<div className="flex items-center justify-between gap-3 text-sm">
							<div className="flex items-center gap-2">
								<CurrencyFlag
									className="!h-4 !w-4 shrink-0"
									currencyCode={item.currency}
								/>
								<span className="font-medium">{item.currency}</span>
							</div>
							<div className="text-right leading-tight">
								<div className="font-medium tabular-nums">
									{item.percentage.toFixed(1)}%
								</div>
								<div className="text-muted-foreground tabular-nums text-xs">
									{isPrivacyMode
										? maskAmount(item.value)
										: formatCurrency(item.value, "USD")}
								</div>
							</div>
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/30">
							<div
								className={cn(
									"h-full rounded-full transition-all",
									getBarColor(index),
								)}
								style={{ width: `${Math.max(0, Math.min(100, item.percentage))}%` }}
							/>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

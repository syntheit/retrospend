"use client";

import { useMemo } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { AllocationSegment } from "~/hooks/use-wealth-dashboard";
import { maskAmount } from "~/lib/masking";

const CURRENCY_COLORS = [
	"hsl(217, 91%, 60%)", // Blue
	"hsl(263, 70%, 50%)", // Violet
	"hsl(38, 92%, 50%)", // Amber
	"hsl(160, 84%, 39%)", // Emerald
	"hsl(350, 89%, 60%)", // Rose
	"hsl(190, 95%, 39%)", // Cyan
	"hsl(25, 95%, 53%)", // Orange
	"hsl(280, 65%, 60%)", // Purple
];

interface WealthPortfolioBreakdownProps {
	allocationData: AllocationSegment[];
	assets: {
		currency: string;
		balanceInUSD: number;
		type: string;
		isLiquid: boolean;
	}[];
	hasMultipleCurrencies: boolean;
	isPrivacyMode?: boolean;
	className?: string;
}

interface CurrencySegment {
	currency: string;
	value: number;
	percentage: number;
	color: string;
	isOther?: boolean;
	otherItems?: { currency: string; value: number; percentage: number }[];
}

function BreakdownBar<T extends { percentage: number; color?: string }>({
	segments,
	renderTooltip,
	getColor,
}: {
	segments: T[];
	renderTooltip: (segment: T) => React.ReactNode;
	getColor: (segment: T) => string;
}) {
	return (
		<div className="flex h-4 w-full overflow-hidden rounded-full bg-muted/50">
			{segments.map((segment, index) => (
				<Tooltip key={index}>
					<TooltipTrigger asChild>
						<div
							className="h-full cursor-pointer transition-opacity hover:opacity-80"
							style={{
								width: `${Math.max(0.5, segment.percentage)}%`,
								backgroundColor: getColor(segment),
								borderRadius:
									index === 0 && index === segments.length - 1
										? "9999px"
										: index === 0
											? "9999px 0 0 9999px"
											: index === segments.length - 1
												? "0 9999px 9999px 0"
												: undefined,
							}}
						/>
					</TooltipTrigger>
					<TooltipContent className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-md">
						{renderTooltip(segment)}
					</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}

export function WealthPortfolioBreakdown({
	allocationData,
	assets,
	hasMultipleCurrencies,
	isPrivacyMode = false,
	className,
}: WealthPortfolioBreakdownProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const currencyData = useMemo(() => {
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
		if (total <= 0) return [];

		const sorted = Object.entries(exposure)
			.map(([currency, value]) => ({
				currency,
				value,
				percentage: (value / total) * 100,
			}))
			.sort((a, b) => b.value - a.value);

		// Group anything below 0.5% as "Other"
		const main: CurrencySegment[] = [];
		const otherItems: { currency: string; value: number; percentage: number }[] = [];

		sorted.forEach((item, index) => {
			if (item.percentage < 0.5) {
				otherItems.push(item);
			} else {
				main.push({
					...item,
					color: CURRENCY_COLORS[index % CURRENCY_COLORS.length]!,
				});
			}
		});

		if (otherItems.length > 0) {
			const otherValue = otherItems.reduce((sum, i) => sum + i.value, 0);
			main.push({
				currency: "Other",
				value: otherValue,
				percentage: (otherValue / total) * 100,
				color: "hsl(0, 0%, 55%)",
				isOther: true,
				otherItems,
			});
		}

		return main;
	}, [assets]);

	const liquidityData = useMemo(() => {
		let liquid = 0;
		let illiquid = 0;
		for (const asset of assets) {
			if (asset.type.startsWith("LIABILITY_")) continue;
			if (asset.isLiquid) {
				liquid += asset.balanceInUSD;
			} else {
				illiquid += asset.balanceInUSD;
			}
		}
		const total = liquid + illiquid;
		if (total <= 0) return [];
		return [
			{ label: "Liquid", value: liquid, percentage: (liquid / total) * 100, color: CURRENCY_COLORS[0]! },
			{ label: "Illiquid", value: illiquid, percentage: (illiquid / total) * 100, color: CURRENCY_COLORS[1]! },
		].filter((s) => s.value > 0);
	}, [assets]);

	if (allocationData.length === 0) return null;

	const formatValue = (value: number) =>
		isPrivacyMode ? maskAmount(value) : formatCurrency(value, "USD");

	return (
		<Card className={cn("border border-border bg-card shadow-sm", className)}>
			<CardContent className="px-5 py-4">
				<p className="mb-3 text-sm font-medium">Portfolio composition</p>
				<div className="flex flex-col gap-4">
					{/* By type */}
					<div className="flex flex-col gap-2">
						<span className="text-xs font-medium text-muted-foreground">
							By type
						</span>
						<div className="flex w-full flex-col gap-2">
							<BreakdownBar
								getColor={(s: AllocationSegment) => s.fill}
								renderTooltip={(segment: AllocationSegment) => (
									<div className="grid gap-1">
										<div className="font-medium">{segment.label}</div>
										<div className="flex items-stretch gap-2">
											<div
												className="my-0.5 w-1 shrink-0 rounded-[2px]"
												style={{ backgroundColor: segment.fill }}
											/>
											<div className="flex flex-1 items-center justify-between gap-4 leading-none">
												<span className="text-muted-foreground">
													{segment.percentage.toFixed(1)}%
												</span>
												<span className="font-semibold text-foreground tabular-nums">
													{formatValue(segment.value)}
												</span>
											</div>
										</div>
									</div>
								)}
								segments={allocationData}
							/>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
								{allocationData.map((item) => (
									<div
										className="flex items-center gap-1.5 text-xs text-muted-foreground"
										key={item.type}
									>
										<div
											className="h-2 w-2 shrink-0 rounded-full"
											style={{ backgroundColor: item.fill }}
										/>
										<span>
											{item.label} {item.percentage.toFixed(0)}%
										</span>
									</div>
								))}
							</div>
						</div>
					</div>

					{/* By currency */}
					{hasMultipleCurrencies && currencyData.length > 0 && (
						<div className="flex flex-col gap-2">
							<span className="text-xs font-medium text-muted-foreground">
								By currency
							</span>
							<div className="flex w-full flex-col gap-2">
								<BreakdownBar
									getColor={(s: CurrencySegment) => s.color}
									renderTooltip={(segment: CurrencySegment) => (
										<div className="grid gap-1">
											<div className="flex items-center gap-1.5 font-medium">
												{!segment.isOther && (
													<CurrencyFlag
														className="!h-3.5 !w-3.5"
														currencyCode={segment.currency}
													/>
												)}
												{segment.currency}
											</div>
											{segment.isOther && segment.otherItems ? (
												<div className="mt-1 grid gap-1.5">
													{segment.otherItems.map((item) => (
														<div
															className="flex items-stretch gap-2"
															key={item.currency}
														>
															<div
																className="my-0.5 w-1 shrink-0 rounded-[2px]"
																style={{ backgroundColor: segment.color }}
															/>
															<div className="flex flex-1 items-center justify-between gap-4 leading-none">
																<span className="text-muted-foreground">
																	{item.currency}
																</span>
																<span className="font-semibold text-foreground tabular-nums">
																	{formatValue(item.value)}
																</span>
															</div>
														</div>
													))}
												</div>
											) : (
												<div className="flex items-stretch gap-2">
													<div
														className="my-0.5 w-1 shrink-0 rounded-[2px]"
														style={{ backgroundColor: segment.color }}
													/>
													<div className="flex flex-1 items-center justify-between gap-4 leading-none">
														<span className="text-muted-foreground">
															{segment.percentage.toFixed(1)}%
														</span>
														<span className="font-semibold text-foreground tabular-nums">
															{formatValue(segment.value)}
														</span>
													</div>
												</div>
											)}
										</div>
									)}
									segments={currencyData}
								/>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									{currencyData
										.filter((item) => item.percentage >= 0.05)
										.map((item) => (
											<div
												className="flex items-center gap-1.5 text-xs text-muted-foreground"
												key={item.currency}
											>
												{item.isOther ? (
													<div className="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
												) : (
													<CurrencyFlag
														className="!h-3.5 !w-3.5"
														currencyCode={item.currency}
													/>
												)}
												<span>
													{item.currency} {item.percentage.toFixed(1)}%
												</span>
											</div>
										))}
								</div>
							</div>
						</div>
					)}

					{/* By liquidity */}
					{liquidityData.length > 0 && (
						<div className="flex flex-col gap-2">
							<span className="text-xs font-medium text-muted-foreground">
								By liquidity
							</span>
							<div className="flex w-full flex-col gap-2">
								<BreakdownBar
									getColor={(s: { color: string }) => s.color}
									renderTooltip={(segment: { label: string; value: number; percentage: number; color: string }) => (
										<div className="grid gap-1">
											<div className="font-medium">{segment.label}</div>
											<div className="flex items-stretch gap-2">
												<div
													className="my-0.5 w-1 shrink-0 rounded-[2px]"
													style={{ backgroundColor: segment.color }}
												/>
												<div className="flex flex-1 items-center justify-between gap-4 leading-none">
													<span className="text-muted-foreground">
														{segment.percentage.toFixed(1)}%
													</span>
													<span className="font-semibold text-foreground tabular-nums">
														{formatValue(segment.value)}
													</span>
												</div>
											</div>
										</div>
									)}
									segments={liquidityData}
								/>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									{liquidityData.map((item) => (
										<div
											className="flex items-center gap-1.5 text-xs text-muted-foreground"
											key={item.label}
										>
											<div
												className="h-2 w-2 shrink-0 rounded-full"
												style={{ backgroundColor: item.color }}
											/>
											<span>
												{item.label} {item.percentage.toFixed(0)}%
											</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

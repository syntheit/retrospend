"use client";

import { PieChartIcon } from "lucide-react";
import { useMemo } from "react";
import { Pie, PieChart } from "recharts";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import type { AssetType } from "~/lib/db-enums";

interface WealthAllocationChartProps {
	assets: {
		type: AssetType;
		balanceInTargetCurrency: number;
	}[];
}

// Base config - vibrant semantic colors for each asset type
const baseChartConfig = {
	CASH: {
		label: "Cash",
		color: "hsl(160, 84%, 39%)", // Emerald green
	},
	INVESTMENT: {
		label: "Investment",
		color: "hsl(217, 91%, 60%)", // Bright blue
	},
	CRYPTO: {
		label: "Crypto",
		color: "hsl(263, 70%, 50%)", // Violet
	},
	REAL_ESTATE: {
		label: "Real Estate",
		color: "hsl(38, 92%, 50%)", // Amber/Gold
	},
	OTHER: {
		label: "Other",
		color: "hsl(25, 95%, 53%)", // Orange
	},
} satisfies ChartConfig;

export function WealthAllocationChart({ assets }: WealthAllocationChartProps) {
	const { data, chartConfig } = useMemo(() => {
		const allocation = assets.reduce(
			(acc, curr) => {
				acc[curr.type] = (acc[curr.type] || 0) + curr.balanceInTargetCurrency;
				return acc;
			},
			{} as Record<AssetType, number>,
		);

		const total = Object.values(allocation).reduce(
			(sum, value) => sum + value,
			0,
		);

		if (total === 0) {
			return { data: [], chartConfig: baseChartConfig, totalValue: 0 };
		}

		// Group small slices (< 5%) into "Other"
		const threshold = total * 0.05; // 5%
		let otherValue = 0;
		const mainSlices: Array<{
			type: string;
			value: number;
			percentage: number;
			fill: string;
		}> = [];

		Object.entries(allocation)
			.filter(([, value]) => value > 0)
			.forEach(([type, value]) => {
				if (value < threshold) {
					otherValue += value;
				} else {
					mainSlices.push({
						type,
						value,
						percentage: (value / total) * 100,
						fill:
							baseChartConfig[type as keyof typeof baseChartConfig]?.color ||
							"var(--chart-5)",
					});
				}
			});

		if (otherValue > 0) {
			mainSlices.push({
				type: "Other",
				value: otherValue,
				percentage: (otherValue / total) * 100,
				fill: "var(--chart-5)",
			});
		}

		const sortedData = mainSlices.sort((a, b) => b.value - a.value);

		// Create dynamic config with percentages
		const dynamicConfig: ChartConfig = {};
		sortedData.forEach((item) => {
			const key = item.type;
			// Use the existing label mapping or title case the type
			const label =
				baseChartConfig[item.type as keyof typeof baseChartConfig]?.label ||
				item.type;
			dynamicConfig[key] = {
				label: label,
				color: item.fill,
			};
		});

		return { data: sortedData, chartConfig: dynamicConfig, totalValue: total };
	}, [assets]);

	// Empty state
	if (data.length === 0) {
		return (
			<Card className="flex h-full flex-col">
				<CardHeader className="items-center pb-0">
					<CardTitle>Asset Allocation</CardTitle>
					<CardDescription>Distribution by asset type</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-1 flex-col items-center justify-center py-12">
					<PieChartIcon className="h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-lg">No assets to display</h3>
					<p className="mt-2 text-center text-muted-foreground text-sm">
						Add assets to see your allocation breakdown.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="flex h-full flex-col">
			<CardHeader className="items-center pb-0">
				<CardTitle>Asset Allocation</CardTitle>
				<CardDescription>Distribution by asset type</CardDescription>
			</CardHeader>
			<CardContent className="flex-1 pb-0">
				<ChartContainer
					className="mx-auto aspect-square max-h-[300px]"
					config={chartConfig}
				>
					<PieChart>
						<ChartTooltip
							content={<ChartTooltipContent hideLabel />}
							cursor={false}
						/>
						<Pie
							data={data}
							dataKey="value"
							innerRadius={60}
							nameKey="type"
							strokeWidth={5}
						/>
						<ChartLegend
							className="-translate-y-2 flex-wrap gap-2 [&>*]:basis-1/4 [&>*]:justify-center"
							content={<ChartLegendContent nameKey="type" />}
						/>
					</PieChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

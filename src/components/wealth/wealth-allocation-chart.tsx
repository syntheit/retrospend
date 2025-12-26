"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart } from "recharts";
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
		balanceInUSD: number;
	}[];
}

const chartConfig = {
	CASH: {
		label: "Cash",
		color: "var(--chart-1)",
	},
	INVESTMENT: {
		label: "Investment",
		color: "var(--chart-2)",
	},
	CRYPTO: {
		label: "Crypto",
		color: "var(--chart-3)",
	},
	REAL_ESTATE: {
		label: "Real Estate",
		color: "var(--chart-4)",
	},
} satisfies ChartConfig;

export function WealthAllocationChart({ assets }: WealthAllocationChartProps) {
	const data = useMemo(() => {
		const allocation = assets.reduce(
			(acc, curr) => {
				acc[curr.type] = (acc[curr.type] || 0) + curr.balanceInUSD;
				return acc;
			},
			{} as Record<AssetType, number>,
		);

		return Object.entries(allocation)
			.map(([type, value]) => ({
				type,
				value,
				fill: chartConfig[type as keyof typeof chartConfig]?.color,
			}))
			.filter((item) => item.value > 0);
	}, [assets]);

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
						>
							{data.map((entry) => (
								<Cell fill={entry.fill} key={entry.type} />
							))}
						</Pie>
						<ChartLegend content={<ChartLegendContent nameKey="type" />} />
					</PieChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

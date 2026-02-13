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

interface WealthAllocationChartProps {
	data: {
		type: string;
		label: string;
		value: number;
		percentage: number;
		fill: string;
	}[];
}

export function WealthAllocationChart({ data }: WealthAllocationChartProps) {
	// Dynamic config for Legend and Tooltip
	const chartConfig = useMemo(() => {
		const config: ChartConfig = {};
		data.forEach((item) => {
			config[item.type] = {
				label: item.label,
				color: item.fill,
			};
		});
		return config;
	}, [data]);

	// Empty state
	if (!data || data.length === 0) {
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

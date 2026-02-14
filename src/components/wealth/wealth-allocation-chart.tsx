"use client";

import { PieChartIcon } from "lucide-react";
import { useMemo } from "react";
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
import { Label, Pie, PieChart, Cell } from "recharts";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

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
	const { formatCurrency } = useCurrencyFormatter();

	// Calculate total
	const totalValue = useMemo(() => {
		return data.reduce((sum, item) => sum + item.value, 0);
	}, [data]);

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
			<Card className="flex h-full flex-col border border-border bg-card shadow-sm">
				<CardHeader className="items-center pb-0">
					<CardTitle className="font-semibold text-lg tracking-tight">Asset Allocation</CardTitle>
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
		<Card className="flex h-full flex-col border border-border bg-card shadow-sm">
			<CardHeader className="items-center pb-0">
				<CardTitle className="font-semibold text-lg tracking-tight">Asset Allocation</CardTitle>
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
							innerRadius="70%"
							outerRadius="85%"
							nameKey="type"
							strokeWidth={0}
							paddingAngle={4}
							cornerRadius={5}
						>
							{data.map((item) => (
								<Cell fill={item.fill} key={item.type} />
							))}
							<Label
								content={({ viewBox }) => {
									if (viewBox && "cx" in viewBox && "cy" in viewBox) {
										return (
											<text
												dominantBaseline="middle"
												textAnchor="middle"
												x={viewBox.cx}
												y={viewBox.cy}
											>
												<tspan
													className="fill-muted-foreground font-medium text-[10px] uppercase tracking-widest"
													x={viewBox.cx}
													y={(viewBox.cy || 0) - 16}
												>
													Total Assets
												</tspan>
												<tspan
													className="fill-foreground font-bold text-2xl tabular-nums tracking-tight"
													x={viewBox.cx}
													y={(viewBox.cy || 0) + 16}
												>
													{formatCurrency(totalValue, "USD")}
												</tspan>
											</text>
										);
									}
								}}
								position="center"
							/>
						</Pie>
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

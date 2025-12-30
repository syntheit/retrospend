"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

interface WealthHistoryChartProps {
	data: { date: string; totalUSD: number }[];
}

const chartConfig = {
	totalUSD: {
		label: "Net Worth",
		color: "var(--primary)",
	},
} satisfies ChartConfig;

export function WealthHistoryChart({ data }: WealthHistoryChartProps) {
	const { formatCurrency } = useCurrencyFormatter();

	// Format data for chart (maybe ensure dates are sorted)
	const chartData = data.sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
	);

	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle>Net Worth History</CardTitle>
				<CardDescription>Trend over the last 12 months</CardDescription>
			</CardHeader>
			<CardContent>
				<ChartContainer
					className="aspect-auto h-[300px] w-full"
					config={chartConfig}
				>
					<AreaChart
						data={chartData}
						margin={{
							top: 10,
							right: 10,
							left: 0,
							bottom: 0,
						}}
					>
						<CartesianGrid strokeDasharray="3 3" vertical={false} />
						<XAxis
							axisLine={false}
							dataKey="date"
							minTickGap={32}
							tickFormatter={(value) => {
								const date = new Date(value);
								return date.toLocaleDateString("en-US", {
									month: "short",
									year: "2-digit",
								});
							}}
							tickLine={false}
							tickMargin={8}
						/>
						<YAxis
							axisLine={false}
							tickFormatter={(value) => `$${value / 1000}k`}
							tickLine={false}
							width={60}
						/>
						<ChartTooltip
							content={
								<ChartTooltipContent
									formatter={(value, name) => (
										<div className="flex w-full items-center justify-between gap-2">
											<span className="font-bold text-muted-foreground">
												{name}
											</span>
											<span className="font-medium font-mono text-foreground tabular-nums">
												{formatCurrency(Number(value), "USD")}
											</span>
										</div>
									)}
									indicator="dot"
									labelFormatter={(value) => {
										return new Date(value).toLocaleDateString("en-US", {
											month: "long",
											day: "numeric",
											year: "numeric",
										});
									}}
								/>
							}
							cursor={false}
						/>
						<Area
							dataKey="totalUSD"
							fill="var(--color-totalUSD)"
							fillOpacity={0.2}
							stroke="var(--color-totalUSD)"
							strokeWidth={2}
							type="monotone"
						/>
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

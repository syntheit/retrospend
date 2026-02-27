"use client";

import { TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { CurrencyPicker } from "~/components/currency-picker";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { CurrencyCode } from "~/lib/currencies";

interface MonthlyDelta {
	month: string;
	delta: number;
}

interface MonthlyDeltaChartProps {
	data: MonthlyDelta[];
	baseCurrency?: string;
	timeRange?: "3M" | "6M" | "12M";
	onBaseCurrencyChange?: (currency: string) => void;
	onTimeRangeChange?: (range: "3M" | "6M" | "12M") => void;
}

const chartConfig: ChartConfig = {
	delta: {
		label: "Net Worth Change",
	},
};

export function MonthlyDeltaChart({
	data,
	baseCurrency = "USD",
	timeRange = "12M",
	onBaseCurrencyChange,
	onTimeRangeChange,
}: MonthlyDeltaChartProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const chartData = useMemo(() => {
		if (!data) return [];
		return data.map((item) => ({
			month: item.month,
			delta: item.delta,
			fill: item.delta >= 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-2))",
		}));
	}, [data]);

	if (!data || data.length === 0) {
		return (
			<Card className="h-full">
				<CardHeader>
					<CardTitle>Monthly Net Worth Changes</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<TrendingUp className="h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-lg">No change data yet</h3>
					<p className="mt-2 text-center text-muted-foreground text-sm">
						Add assets and track changes over time to see monthly trends.
					</p>
				</CardContent>
			</Card>
		);
	}

	const formatTooltipValue = (value: number) => {
		const sign = value >= 0 ? "+" : "";
		return `${sign}${formatCurrency(value, baseCurrency)}`;
	};

	return (
		<Card className="h-full">
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>Monthly Net Worth Changes</CardTitle>
				{(onBaseCurrencyChange || onTimeRangeChange) && (
					<div className="flex items-center gap-3">
						{onTimeRangeChange && (
							<ToggleGroup
								onValueChange={(value) => {
									if (value) onTimeRangeChange(value as "3M" | "6M" | "12M");
								}}
								size="sm"
								type="single"
								value={timeRange}
							>
								<ToggleGroupItem aria-label="3 months" value="3M">
									3M
								</ToggleGroupItem>
								<ToggleGroupItem aria-label="6 months" value="6M">
									6M
								</ToggleGroupItem>
								<ToggleGroupItem aria-label="12 months" value="12M">
									12M
								</ToggleGroupItem>
							</ToggleGroup>
						)}
						{onBaseCurrencyChange && (
							<CurrencyPicker
								onValueChange={onBaseCurrencyChange}
								value={baseCurrency as CurrencyCode}
							/>
						)}
					</div>
				)}
			</CardHeader>
			<CardContent>
				<ChartContainer config={chartConfig}>
					<BarChart
						data={chartData}
						margin={{
							top: 20,
							right: 30,
							left: 20,
							bottom: 5,
						}}
					>
						<XAxis
							axisLine={false}
							dataKey="month"
							tick={{ fontSize: 12 }}
							tickLine={false}
						/>
						<YAxis
							axisLine={false}
							tick={{ fontSize: 12 }}
							tickFormatter={(value) => formatCurrency(value, baseCurrency)}
							tickLine={false}
						/>
						<ChartTooltip
							content={
								<ChartTooltipContent
									formatter={(value, name, item) => (
										<>
											<div
												className="h-2 w-2 shrink-0 rounded-[2px]"
												style={{
													backgroundColor: item.color || item.payload.fill,
												}}
											/>
											<div className="flex flex-1 items-center justify-between gap-4 leading-none">
												<span className="text-muted-foreground">
													{chartConfig[name as keyof typeof chartConfig]
														?.label || name}
												</span>
												<span className="font-semibold text-foreground tabular-nums">
													{formatTooltipValue(Number(value))}
												</span>
											</div>
										</>
									)}
									hideLabel
								/>
							}
						/>
						<ReferenceLine
							stroke="hsl(var(--muted-foreground))"
							strokeDasharray="3 3"
							strokeWidth={1}
							y={0}
						/>
						<Bar dataKey="delta" radius={[2, 2, 0, 0]}>
							{chartData.map((entry) => (
								<Cell fill={entry.fill} key={entry.month} />
							))}
						</Bar>
					</BarChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

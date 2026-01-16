import { TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CurrencyPicker } from "~/components/currency-picker";
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
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { CurrencyCode } from "~/lib/currencies";
import { parseDateOnly } from "~/lib/date";

interface WealthHistoryChartProps {
	data: { date: string; amount: number }[];
	baseCurrency?: string;
	timeRange?: "3M" | "6M" | "12M";
	onBaseCurrencyChange?: (currency: string) => void;
	onTimeRangeChange?: (range: "3M" | "6M" | "12M") => void;
}

const chartConfig = {
	amount: {
		label: "Net Worth",
		color: "var(--primary)",
	},
} satisfies ChartConfig;

export function WealthHistoryChart({
	data,
	baseCurrency = "USD",
	timeRange = "12M",
	onBaseCurrencyChange,
	onTimeRangeChange,
}: WealthHistoryChartProps) {
	const { formatCurrency, getCurrencySymbol } = useCurrencyFormatter();

	const filteredData = useMemo(() => {
		if (!data) return [];
		const sorted = [...data].sort(
			(a, b) =>
				parseDateOnly(a.date).getTime() - parseDateOnly(b.date).getTime(),
		);

		if (!timeRange) return sorted;

		const now = new Date();
		const months = timeRange === "3M" ? 3 : timeRange === "6M" ? 6 : 12;
		const cutoff = new Date(
			now.getFullYear(),
			now.getMonth() - months,
			now.getDate(),
		);

		return sorted.filter((item) => parseDateOnly(item.date) >= cutoff);
	}, [data, timeRange]);

	const compactNumberFormatter = useMemo(() => {
		return new Intl.NumberFormat("en-US", {
			notation: "compact",
			maximumFractionDigits: 1,
		});
	}, []);

	const formatCompactCurrency = (value: number, currency: string): string => {
		const symbol = getCurrencySymbol(currency);
		return `${symbol}${compactNumberFormatter.format(value)}`;
	};

	if (!data || data.length === 0) {
		return (
			<Card className="h-full">
				<CardHeader>
					<CardTitle>Net Worth History</CardTitle>
					<CardDescription>Trend over the last 12 months</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<TrendingUp className="h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-lg">No history data yet</h3>
					<p className="mt-2 text-center text-muted-foreground text-sm">
						Start tracking your net worth over time to see historical trends.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="h-full">
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle>Net Worth History</CardTitle>
					<CardDescription>Trend over time</CardDescription>
				</div>
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
								<ToggleGroupItem
									aria-label="3 months"
									className="cursor-pointer"
									value="3M"
								>
									3M
								</ToggleGroupItem>
								<ToggleGroupItem
									aria-label="6 months"
									className="cursor-pointer"
									value="6M"
								>
									6M
								</ToggleGroupItem>
								<ToggleGroupItem
									aria-label="12 months"
									className="cursor-pointer"
									value="12M"
								>
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
				<ChartContainer
					className="aspect-auto h-[300px] w-full"
					config={chartConfig}
				>
					<AreaChart
						data={filteredData}
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
								const date = parseDateOnly(value);
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
							tickFormatter={(value) =>
								formatCompactCurrency(value, baseCurrency)
							}
							tickLine={false}
							width={80}
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
												{formatCurrency(Number(value), baseCurrency)}
											</span>
										</div>
									)}
									indicator="dot"
									labelFormatter={(value) => {
										return parseDateOnly(value).toLocaleDateString("en-US", {
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
							dataKey="amount"
							fill="var(--color-amount)"
							fillOpacity={0.2}
							stroke="var(--color-amount)"
							strokeWidth={2}
							type="monotone"
						/>
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

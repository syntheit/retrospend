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
import {
	ASSET_COLORS,
	TIME_RANGES,
	type TimeRangeValue,
} from "~/lib/wealth-constants";

interface WealthHistoryChartProps {
	data: { date: string; amount: number; assets?: number; liabilities?: number }[];
	baseCurrency?: string;
	timeRange?: TimeRangeValue;
	onBaseCurrencyChange?: (currency: string) => void;
	onTimeRangeChange?: (range: TimeRangeValue) => void;
}

const chartConfig = {
	amount: {
		label: "Net Worth",
		color: "var(--primary)",
	},
	assets: {
		label: "Assets",
		color: ASSET_COLORS.CASH, // Using primary asset color for assets line
	},
	liabilities: {
		label: "Liabilities",
		color: ASSET_COLORS.LIABILITY_LOAN, // Using primary liability color for liabilities line
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
					<CardDescription>Trend over time</CardDescription>
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
									if (value) onTimeRangeChange(value as TimeRangeValue);
								}}
								size="sm"
								type="single"
								value={timeRange}
							>
								{TIME_RANGES.map((range) => (
									<ToggleGroupItem
										className="cursor-pointer"
										key={range.value}
										value={range.value}
									>
										{range.label}
									</ToggleGroupItem>
								))}
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
						data={data}
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
									formatter={(value, name, item) => (
										<div className="flex w-full items-center justify-between gap-4">
											<div className="flex items-center gap-2">
												<div
													className="h-2 w-2 rounded-full"
													style={{ backgroundColor: item.color }}
												/>
												<span className="font-bold text-muted-foreground uppercase text-[10px] tracking-wider">
													{chartConfig[name as keyof typeof chartConfig]
														?.label || name}
												</span>
											</div>
											<span className="font-semibold font-mono text-foreground tabular-nums">
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
							fillOpacity={0.1}
							stroke="var(--color-amount)"
							strokeWidth={2}
							type="monotone"
						/>
						{data[0]?.assets !== undefined && (
							<>
								<Area
									dataKey="assets"
									fill="var(--color-assets)"
									fillOpacity={0.05}
									stroke="var(--color-assets)"
									strokeDasharray="4 4"
									strokeWidth={1}
									type="monotone"
								/>
								<Area
									dataKey="liabilities"
									fill="var(--color-liabilities)"
									fillOpacity={0.05}
									stroke="var(--color-liabilities)"
									strokeDasharray="4 4"
									strokeWidth={1}
									type="monotone"
								/>
							</>
						)}
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

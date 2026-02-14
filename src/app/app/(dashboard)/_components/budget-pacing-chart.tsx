"use client";

import { useId } from "react";
import {
	Area,
	CartesianGrid,
	XAxis,
	YAxis,
	Line,
	ComposedChart
} from "recharts";

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import { Skeleton } from "~/components/ui/skeleton";
import { formatCurrency as formatCurrencyUtil } from "~/lib/utils";

interface BudgetPacingChartProps {
	expensesLoading: boolean;
	dailyTrend: Array<{
		day: string;
		dateLabel: string;
		value: number; // Legacy total
		total: number;
		fixed: number;
		variable: number;
	}>;
	chartConfig: ChartConfig;
	variableBudget: number;
	variableSpent: number;
	daysInMonth: number;
	currentDay: number; // 1-31
	homeCurrency: string;
}

export function BudgetPacingChart({
	expensesLoading,
	dailyTrend,
	chartConfig,
	variableBudget,
	variableSpent,
	daysInMonth,
	currentDay,
	homeCurrency,
}: BudgetPacingChartProps) {
	const id = useId();

	// Custom Y-axis formatter
	const formatYAxis = (value: number) => {
		if (value >= 1000) {
			return `${formatCurrencyUtil(value / 1000, homeCurrency, "native", false).replace(/\.00$/, "")}k`;
		}
		return formatCurrencyUtil(value, homeCurrency, "native", false).replace(
			/\.00$/,
			"",
		);
	};

	// Calculate "Guide" data points based on VARIABLE budget
	const chartData = dailyTrend.map((point, index) => {
		const dayNum = index + 1; 
		const guideValue = (variableBudget / daysInMonth) * dayNum;
		
		return {
			...point,
			guide: guideValue,
		};
	});

	// Dynamic Coloring Logic
	const lastPoint = chartData[chartData.length - 1];
	const currentVariableReality = lastPoint?.variable ?? 0;
	const currentVariableGuide = lastPoint?.guide ?? 0;
	
	const isOverPacing = currentVariableReality > currentVariableGuide;

	const areaColor = isOverPacing ? "#f59e0b" : "#10b981"; // Amber or Emerald
	const gradientId = `fillGradient-${id}`;

	// Context Header Calc: "Daily Safe-to-Spend"
	const daysLeft = Math.max(1, daysInMonth - currentDay);
	const remainingVariableBudget = Math.max(0, variableBudget - (variableSpent || currentVariableReality));
	const safeToSpend = remainingVariableBudget / daysLeft;

	return (
		<Card className="relative flex h-full flex-col">
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<div>
					<CardTitle className="text-lg font-semibold">
						Budget Pacing
					</CardTitle>
					<p className="text-sm text-muted-foreground">
						Variable spend vs. ideal pace
					</p>
				</div>
				<div className="text-right">
					<div className="text-2xl font-bold">
						{formatCurrencyUtil(safeToSpend, homeCurrency, "standard", false)} 
						<span className="text-base font-normal text-muted-foreground"> / day</span>
					</div>
					<p className="text-xs text-muted-foreground">safe to spend</p>
				</div>
			</CardHeader>
			<CardContent className="min-h-0 flex-1 px-2 pb-6 sm:px-6">
				{expensesLoading ? (
					<Skeleton className="h-[280px] w-full rounded-xl" />
				) : (
					<ChartContainer className="h-full w-full" config={chartConfig}>
						<ComposedChart data={chartData}>
							<defs>
								<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
									<stop
										offset="5%"
										stopColor={areaColor}
										stopOpacity={0.8}
									/>
									<stop
										offset="95%"
										stopColor={areaColor}
										stopOpacity={0.1}
									/>
								</linearGradient>
							</defs>
							<CartesianGrid
								strokeDasharray="3 3"
								strokeOpacity={0.2}
								vertical={false}
							/>
							<XAxis
								axisLine={false}
								dataKey="day"
								fontSize={12}
								minTickGap={24}
								strokeOpacity={0.5}
								tickLine={false}
								tickMargin={8}
							/>
							<YAxis
								axisLine={false}
								fontSize={12}
								strokeOpacity={0.5}
								tickFormatter={formatYAxis}
								tickLine={false}
								tickMargin={8}
								width={40}
							/>
							<ChartTooltip content={<ChartTooltipContent 
                                labelFormatter={(label, payload) => {
                                    if (payload && payload.length > 0) {
                                        return payload[0]?.payload.dateLabel;
                                    }
                                    return label;
                                }}
                            />} />
							
							{/* Series A: The Guide */}
							<Line 
								dataKey="guide"
								stroke="#525252"
								strokeDasharray="5 5"
								strokeWidth={2}
								dot={false}
                                activeDot={false}
                                name="Ideal Pace"
							/>

							{/* Series B: The Reality (Variable Only) */}
							<Area
								dataKey="variable"
								fill={`url(#${gradientId})`}
								stroke={areaColor}
								strokeWidth={2.5}
								type="monotone"
                                name="Variable Spend"
							/>
						</ComposedChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}

"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
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
import { Skeleton } from "~/components/ui/skeleton";

interface TrendChartProps {
	expensesLoading: boolean;
	dailyTrend: Array<{
		day: string;
		dateLabel: string;
		value: number;
	}>;
	areaChartConfig: ChartConfig;
	now: Date;
}

const vibrantBlue = "hsl(217, 91%, 60%)";

export function TrendChart({
	expensesLoading,
	dailyTrend,
	areaChartConfig,
	now,
}: TrendChartProps) {
	const id = useId();

	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					Cumulative Spending
				</CardTitle>
				<CardDescription>
					Cumulative spending for{" "}
					{now.toLocaleDateString("en-US", { month: "long" })}
				</CardDescription>
			</CardHeader>
			<CardContent className="px-2 pb-6 sm:px-6">
				{expensesLoading ? (
					<Skeleton className="h-[280px] w-full rounded-xl" />
				) : (
					<ChartContainer
						className="aspect-[16/6] h-full"
						config={areaChartConfig}
					>
						<AreaChart data={dailyTrend}>
							<defs>
								<linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
									<stop offset="5%" stopColor={vibrantBlue} stopOpacity={0.8} />
									<stop
										offset="95%"
										stopColor={vibrantBlue}
										stopOpacity={0.1}
									/>
								</linearGradient>
							</defs>
							<CartesianGrid vertical={false} />
							<XAxis
								axisLine={false}
								dataKey="day"
								minTickGap={24}
								tickLine={false}
								tickMargin={8}
							/>
							<ChartTooltip content={<ChartTooltipContent nameKey="spend" />} />
							<Area
								dataKey="value"
								fill={`url(#${id})`}
								stroke={vibrantBlue}
								strokeWidth={2.5}
								type="monotone"
							/>
						</AreaChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}

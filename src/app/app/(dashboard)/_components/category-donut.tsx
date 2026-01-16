"use client";

import { useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, Sector } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { type ChartConfig, ChartContainer } from "~/components/ui/chart";
import { Skeleton } from "~/components/ui/skeleton";
import {
	CategoryDonutLegend,
	type CategorySegment,
} from "./category-donut-legend";

interface CategoryDonutProps {
	expensesLoading: boolean;
	categoryBreakdown: CategorySegment[];
	visibleCategoryBreakdown: CategorySegment[];
	activeSliceIndex: number | null;
	activeSlice: CategorySegment | null | undefined;
	visibleTotal: number;
	pieChartConfig: ChartConfig;
	hiddenCategories: Set<string>;
	categoryClickBehavior: string;
	formatMoney: (value: number) => string;
	isUsingMockExpenses: boolean;
	handleCategoryClick: (segment: CategorySegment) => void;
	handleSliceEnter: (data: PieSectorDataItem, index: number) => void;
	handleSliceLeave: () => void;
}

function renderActiveShape(
	props: PieSectorDataItem,
	stroke: string,
	strokeWidth: number,
) {
	const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } =
		props;
	return (
		<Sector
			className="cursor-pointer"
			cx={cx}
			cy={cy}
			endAngle={endAngle}
			fill={fill}
			innerRadius={innerRadius}
			outerRadius={(outerRadius || 0) + 8}
			startAngle={startAngle}
			stroke={stroke}
			strokeWidth={strokeWidth}
		/>
	);
}

export function CategoryDonut({
	expensesLoading,
	categoryBreakdown,
	visibleCategoryBreakdown,
	activeSliceIndex,
	activeSlice,
	visibleTotal,
	pieChartConfig,
	hiddenCategories,
	categoryClickBehavior,
	formatMoney,
	isUsingMockExpenses,
	handleCategoryClick,
	handleSliceEnter,
	handleSliceLeave,
}: CategoryDonutProps) {
	const [pieRadii, setPieRadii] = useState<{ inner: number; outer: number }>({
		inner: 100,
		outer: 175,
	});
	const pieWrapperRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const target = pieWrapperRef.current;
		if (
			!target ||
			typeof window === "undefined" ||
			!("ResizeObserver" in window)
		) {
			return;
		}

		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.contentRect.width ?? 0;
			if (!width) return;

			const outer = Math.min(175, Math.max(110, width / 2 - 12));
			const inner = Math.max(72, Math.min(outer * 0.64, outer - 32));
			setPieRadii({ inner, outer });
		});

		observer.observe(target);
		return () => observer.disconnect();
	}, []);

	const isSingleSlice = visibleCategoryBreakdown.length <= 1;
	const piePaddingAngle = isSingleSlice ? 0 : 1;
	const pieStroke = isSingleSlice ? "none" : "var(--card)";
	const pieStrokeWidth = isSingleSlice ? 0 : 3;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					Category Distribution
				</CardTitle>
				<CardDescription>Where your money went this month</CardDescription>
			</CardHeader>
			<CardContent>
				{expensesLoading ? (
					<Skeleton className="h-[280px] w-full rounded-xl" />
				) : categoryBreakdown.length === 0 ? (
					<div className="rounded-lg border bg-muted/40 p-4 text-sm">
						No expenses logged this month.
					</div>
				) : (
					<div className="relative mx-auto w-full max-w-xl" ref={pieWrapperRef}>
						<ChartContainer
							className="aspect-square w-full sm:aspect-[4/3]"
							config={pieChartConfig}
						>
							<PieChart>
								<Pie
									activeIndex={activeSliceIndex ?? undefined}
									activeShape={(props: PieSectorDataItem) =>
										renderActiveShape(props, pieStroke, pieStrokeWidth)
									}
									data={visibleCategoryBreakdown}
									dataKey="value"
									innerRadius={pieRadii.inner}
									nameKey="name"
									onClick={(_, index) => {
										const segment = visibleCategoryBreakdown[index];
										if (segment) {
											handleCategoryClick(segment);
										}
									}}
									onMouseEnter={handleSliceEnter}
									onMouseLeave={handleSliceLeave}
									outerRadius={pieRadii.outer}
									paddingAngle={piePaddingAngle}
									stroke={pieStroke}
									strokeWidth={pieStrokeWidth}
								>
									{visibleCategoryBreakdown.map((segment, index) => (
										<Cell
											className="cursor-pointer transition-opacity"
											fill={`var(--color-${segment.key})`}
											key={segment.key}
											opacity={
												activeSliceIndex === null || activeSliceIndex === index
													? 1
													: 0.4
											}
											stroke={pieStroke}
											strokeWidth={pieStrokeWidth}
										/>
									))}
								</Pie>
								<text
									className="pointer-events-none fill-foreground"
									dominantBaseline="middle"
									style={{ fontSize: "14px", fontWeight: "500" }}
									textAnchor="middle"
									x="50%"
									y="48%"
								>
									<tspan
										className="fill-muted-foreground"
										dy="-0.5em"
										style={{ fontSize: "12px" }}
										x="50%"
									>
										{activeSlice ? activeSlice.name : "Total"}
									</tspan>
									<tspan
										dy="1.2em"
										style={{ fontSize: "24px", fontWeight: "600" }}
										x="50%"
									>
										{activeSlice
											? formatMoney(activeSlice.value)
											: formatMoney(visibleTotal)}
									</tspan>
								</text>
							</PieChart>
						</ChartContainer>

						<CategoryDonutLegend
							categoryClickBehavior={categoryClickBehavior}
							data={categoryBreakdown}
							formatMoney={formatMoney}
							hiddenCategories={hiddenCategories}
							onCategoryClick={handleCategoryClick}
						/>

						{isUsingMockExpenses && (
							<p className="mt-3 text-muted-foreground text-xs">
								Using sample data until expenses are added.
							</p>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

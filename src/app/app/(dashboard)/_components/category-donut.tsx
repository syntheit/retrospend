"use client";

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
					<div className="relative mx-auto w-full max-w-xl">
						<div className="relative">
							{/* Center Text UI */}
							<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
								<span className="font-medium text-muted-foreground text-xs sm:text-sm">
									{activeSlice ? activeSlice.name : "Total"}
								</span>
								<span className="font-bold text-2xl tracking-tight sm:text-3xl">
									{activeSlice
										? formatMoney(activeSlice.value)
										: formatMoney(visibleTotal)}
								</span>
							</div>

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
										cx="50%"
										cy="50%"
										data={visibleCategoryBreakdown}
										dataKey="value"
										innerRadius="65%"
										nameKey="name"
										onClick={(_, index) => {
											const segment = visibleCategoryBreakdown[index];
											if (segment) {
												handleCategoryClick(segment);
											}
										}}
										onMouseEnter={handleSliceEnter}
										onMouseLeave={handleSliceLeave}
										outerRadius="85%"
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
								</PieChart>
							</ChartContainer>
						</div>

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

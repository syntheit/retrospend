"use client";

import { Cell, Label, Pie, PieChart, Sector } from "recharts";
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
					<div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
						<div className="relative mx-auto w-full max-w-[300px] shrink-0">
							<ChartContainer
								className="aspect-square w-full"
								config={pieChartConfig}
							>
								<PieChart>
									<Pie
										activeIndex={activeSliceIndex ?? undefined}
										activeShape={(props: PieSectorDataItem) =>
											renderActiveShape(props, "none", 0)
										}
										cornerRadius={5}
										cx="50%"
										cy="50%"
										data={visibleCategoryBreakdown}
										dataKey="value"
										innerRadius="70%"
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
										paddingAngle={4}
										stroke="none"
									>
										{visibleCategoryBreakdown.map((segment, index) => (
											<Cell
												className="cursor-pointer transition-opacity"
												fill={`var(--color-${segment.key})`}
												key={segment.key}
												opacity={
													activeSliceIndex === null || activeSliceIndex === index
														? 1
														: 0.3
												}
												stroke="none"
											/>
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
																className="fill-muted-foreground text-xs font-medium uppercase tracking-widest"
																x={viewBox.cx}
																y={(viewBox.cy || 0) - 16}
															>
																{activeSlice ? activeSlice.name : "TOTAL SPEND"}
															</tspan>
															<tspan
																className="fill-foreground font-bold text-3xl"
																x={viewBox.cx}
																y={(viewBox.cy || 0) + 16}
															>
																{activeSlice
																	? formatMoney(activeSlice.value)
																	: formatMoney(visibleTotal)}
															</tspan>
														</text>
													);
												}
											}}
											position="center"
										/>
									</Pie>
								</PieChart>
							</ChartContainer>
						</div>

						<div className="flex flex-1 flex-col justify-center">
							<CategoryDonutLegend
								categoryClickBehavior={categoryClickBehavior}
								data={categoryBreakdown}
								formatMoney={formatMoney}
								hiddenCategories={hiddenCategories}
								onCategoryClick={handleCategoryClick}
								onMouseEnter={(_, index) => {
									// The legend uses categoryBreakdown, which might be different from visibleCategoryBreakdown
									// We need to find the index of this segment in visibleCategoryBreakdown
									const segment = categoryBreakdown[index];
									if (segment) {
										const visibleIndex = visibleCategoryBreakdown.findIndex(
											(s) => s.key === segment.key,
										);
										if (visibleIndex !== -1) {
											handleSliceEnter({} as PieSectorDataItem, visibleIndex);
										}
									}
								}}
								onMouseLeave={handleSliceLeave}
							/>

							{isUsingMockExpenses && (
								<p className="mt-4 text-center text-muted-foreground text-xs lg:text-left">
									Using sample data until expenses are added.
								</p>
							)}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

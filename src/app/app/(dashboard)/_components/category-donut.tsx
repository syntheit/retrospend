"use client";

import { useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, Sector } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ChartContainer, type ChartConfig } from "~/components/ui/chart";
import { Skeleton } from "~/components/ui/skeleton";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn } from "~/lib/utils";

interface CategoryDonutProps {
	expensesLoading: boolean;
	categoryBreakdown: Array<{
		key: string;
		name: string;
		value: number;
		color: string | undefined;
		categoryColor?: string;
		categoryId?: string;
	}>;
	visibleCategoryBreakdown: Array<{
		key: string;
		name: string;
		value: number;
		color: string | undefined;
		categoryColor?: string;
		categoryId?: string;
	}>;
	activeSliceIndex: number | null;
	activeSlice: {
		key: string;
		name: string;
		value: number;
		color: string | undefined;
		categoryColor?: string;
		categoryId?: string;
	} | null | undefined;
	visibleTotal: number;
	pieChartConfig: ChartConfig;
	hiddenCategories: Set<string>;
	categoryClickBehavior: string;
	formatMoney: (value: number) => string;
	isUsingMockExpenses: boolean;
	resolveCategoryColorValue: (color?: string) => string | null;
	handleCategoryClick: (segment: any) => void;
	handleSliceEnter: (event: any, index: number) => void;
	handleSliceLeave: () => void;
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
	resolveCategoryColorValue,
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
				<CardDescription>
					Where your money went this month
				</CardDescription>
			</CardHeader>
			<CardContent>
				{expensesLoading ? (
					<Skeleton className="h-[280px] w-full rounded-xl" />
				) : categoryBreakdown.length === 0 ? (
					<div className="rounded-lg border bg-muted/40 p-4 text-sm">
						No expenses logged this month.
					</div>
				) : (
					<div
						className="relative mx-auto w-full max-w-xl"
						ref={pieWrapperRef}
					>
						<ChartContainer
							className="aspect-square w-full sm:aspect-[4/3]"
							config={pieChartConfig}
						>
							<PieChart>
								<Pie
									activeIndex={activeSliceIndex ?? undefined}
									activeShape={(props: PieSectorDataItem) => {
										const {
											cx,
											cy,
											innerRadius = 0,
											outerRadius = 0,
											startAngle,
											endAngle,
											fill,
										} = props;
										return (
											<Sector
												className="cursor-pointer"
												cx={cx}
												cy={cy}
												endAngle={endAngle}
												fill={fill}
												innerRadius={innerRadius}
												outerRadius={outerRadius + 8}
												startAngle={startAngle}
												stroke={pieStroke}
												strokeWidth={pieStrokeWidth}
											/>
										);
									}}
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
												activeSliceIndex === null ||
												activeSliceIndex === index
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
						<div className="mt-4 grid gap-2 sm:grid-cols-2">
							{categoryBreakdown.map((segment) => {
								const dotClass = segment.categoryColor
									? CATEGORY_COLOR_MAP[
											segment.categoryColor as keyof typeof CATEGORY_COLOR_MAP
										]?.split(" ")[0]
									: "bg-muted-foreground";
								const isHidden =
									segment.categoryId &&
									hiddenCategories.has(segment.categoryId);
								return (
									<button
										className={cn(
											"group flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left transition-all",
											isHidden
												? "bg-muted/20 opacity-60 hover:bg-muted/30"
												: "bg-muted/30 hover:bg-muted/50",
										)}
										key={segment.key}
										{...(categoryClickBehavior === "toggle" &&
										!!segment.categoryId
											? {
													"aria-pressed": Boolean(isHidden),
												}
											: {})}
										onClick={() => handleCategoryClick(segment)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												handleCategoryClick(segment);
											}
										}}
										type="button"
									>
										<div className="flex items-center gap-2">
											<span
												className={cn(
													"h-3 w-3 rounded-full",
													dotClass,
													isHidden && "opacity-50",
												)}
											/>
											<span
												className={cn(
													"text-sm transition-all",
													isHidden
														? "line-through opacity-70"
														: "group-hover:underline",
												)}
											>
												{segment.name}
											</span>
										</div>
										<span
											className={cn(
												"font-semibold text-sm",
												isHidden && "opacity-70",
											)}
										>
											{formatMoney(segment.value)}
										</span>
									</button>
								);
							})}
						</div>
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

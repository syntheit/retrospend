"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Cell, Label, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { type ChartConfig, ChartContainer } from "~/components/ui/chart";
import { COLOR_TO_HEX } from "~/lib/constants";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

interface CategoryStat {
	categoryId: string | null;
	name: string;
	color: string;
	total: number;
	count: number;
}

interface CategoryBreakdownProps {
	categories: CategoryStat[];
	totalSpent: number;
	currency: string;
}

const DEFAULT_COLORS = [
	"#10b981",
	"#3b82f6",
	"#f59e0b",
	"#ef4444",
	"#8b5cf6",
	"#06b6d4",
	"#ec4899",
	"#84cc16",
	"#f97316",
	"#6366f1",
];

export function CategoryBreakdown({
	categories,
	totalSpent,
	currency,
}: CategoryBreakdownProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const [activeIndex, setActiveIndex] = useState<number | null>(null);

	if (categories.length === 0) {
		return (
			<Card className="border border-border bg-card shadow-sm">
				<CardHeader className="px-4 sm:px-6">
					<CardTitle className="font-semibold text-lg tracking-tight">
						Category Breakdown
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="rounded-lg border bg-muted/40 p-4 text-muted-foreground text-sm">
						No expenses logged yet.
					</div>
				</CardContent>
			</Card>
		);
	}

	const data = categories.map((cat, i) => ({
		name: cat.name,
		value: cat.total,
		key: cat.categoryId ?? `cat-${i}`,
		fill:
			COLOR_TO_HEX[cat.color] ??
			DEFAULT_COLORS[i % DEFAULT_COLORS.length],
	}));

	const config: ChartConfig = {};
	for (const d of data) {
		config[d.key] = { label: d.name, color: d.fill };
	}

	const activeSlice = activeIndex !== null ? data[activeIndex] : null;

	return (
		<Card className="border border-border bg-card shadow-sm">
			<CardHeader className="px-4 sm:px-6">
				<CardTitle className="font-semibold text-lg tracking-tight">
					Category Breakdown
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-6 xl:flex-row xl:items-center">
					{/* Donut */}
					<div className="relative mx-auto w-full max-w-[220px] shrink-0">
						<ChartContainer className="aspect-square w-full" config={config}>
							<PieChart>
								<Pie
									cornerRadius={4}
									cx="50%"
									cy="50%"
									data={data}
									dataKey="value"
									innerRadius="65%"
									nameKey="name"
									onMouseEnter={(_, index) => setActiveIndex(index)}
									onMouseLeave={() => setActiveIndex(null)}
									outerRadius="85%"
									paddingAngle={3}
									stroke="none"
								>
									{data.map((entry, index) => (
										<Cell
											className="transition-opacity"
											fill={entry.fill}
											key={entry.key}
											opacity={
												activeIndex === null || activeIndex === index ? 1 : 0.3
											}
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
															className="fill-muted-foreground font-medium text-[10px] tracking-wide"
															x={viewBox.cx}
															y={(viewBox.cy || 0) - 12}
														>
															{activeSlice ? activeSlice.name : "Total"}
														</tspan>
														<tspan
															className="fill-foreground font-bold text-lg tabular-nums tracking-tight"
															x={viewBox.cx}
															y={(viewBox.cy || 0) + 14}
														>
															{formatCurrency(
																activeSlice ? activeSlice.value : totalSpent,
																currency,
															)}
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

					{/* Legend */}
					<div className="flex flex-1 flex-col gap-1.5">
						{data.map((entry, i) => {
							const pct =
								totalSpent > 0
									? ((entry.value / totalSpent) * 100).toFixed(1)
									: "0";
							return (
								<Button
									className="flex h-auto w-full items-center justify-between gap-2 px-2 py-1 text-left text-sm hover:bg-accent/50"
									key={entry.key}
									onMouseEnter={() => setActiveIndex(i)}
									onMouseLeave={() => setActiveIndex(null)}
									type="button"
									variant="ghost"
								>
									<div className="flex items-center gap-2">
										<div
											className="h-2.5 w-2.5 shrink-0 rounded-sm"
											style={{ backgroundColor: entry.fill }}
										/>
										<span className="truncate">{entry.name}</span>
									</div>
									<div className="flex items-center gap-3 text-muted-foreground">
										<span className="tabular-nums">{pct}%</span>
										<span className="font-medium text-foreground tabular-nums">
											{formatCurrency(entry.value, currency)}
										</span>
									</div>
								</Button>
							);
						})}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

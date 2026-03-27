"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { TooltipProps } from "recharts";
import {
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
	Tooltip as UITooltip,
} from "~/components/ui/tooltip";
import type { BucketSize } from "~/lib/chart-granularity";
import type { CategoryColor } from "~/lib/constants";

// Map category color keys to actual hex color values
export const CATEGORY_COLOR_HEX_MAP: Record<CategoryColor, string> = {
	emerald: "#059669",
	blue: "#2563eb",
	sky: "#0ea5e9",
	cyan: "#0891b2",
	teal: "#0d9488",
	orange: "#f97316",
	amber: "#f59e0b",
	violet: "#7c3aed",
	pink: "#ec4899",
	fuchsia: "#c026d3",
	indigo: "#4f46e5",
	slate: "#334155",
	zinc: "#52525b",
	lime: "#65a30d",
	neutral: "#525252",
	gray: "#6b7280",
	purple: "#9333ea",
	yellow: "#eab308",
	stone: "#78716c",
	rose: "#f43f5e",
	red: "#dc2626",
};

export interface CategoryTrendRow {
	id: string;
	category: {
		id: string;
		name: string;
		color: string;
	};
	currentPeriodTotal: number;
	periodAverage: number;
	trendData: Array<{
		key: string;
		label: string;
		amount: number;
	}>;
	isTrendingDown: boolean;
	percentageChange: number;
	periodOverPeriodChange: number;
}

function SparklineTooltip({
	active,
	payload,
	formatCurrency,
}: TooltipProps<number, string> & {
	formatCurrency: (amount: number) => string;
}) {
	if (active && payload && payload.length) {
		const data = payload[0]?.payload;
		return (
			<div className="rounded-lg border border-border bg-background p-2 text-xs shadow-md">
				<div className="font-medium">{data?.label}</div>
				<div className="text-muted-foreground">
					{formatCurrency(data?.amount || 0)}
				</div>
			</div>
		);
	}
	return null;
}

function formatPercentage(percentage: number) {
	const sign = percentage >= 0 ? "+" : "";
	return `${sign}${percentage.toFixed(1)}%`;
}

export function createCategoryTrendColumns(
	formatCurrency: (amount: number) => string,
	bucketSize: BucketSize,
	getPeriodLabel: (bucketSize: BucketSize) => string,
): ColumnDef<CategoryTrendRow>[] {
	const periodLabel = getPeriodLabel(bucketSize);

	return [
		{
			accessorKey: "category",
			header: "Category",
			enableSorting: true,
			meta: { flex: true },
			sortingFn: (rowA, rowB) => {
				const a = rowA.original.category.name;
				const b = rowB.original.category.name;
				return a.localeCompare(b);
			},
			cell: ({ row }) => (
				<div className="flex items-center gap-2">
					<div
						className="h-3 w-3 flex-shrink-0 rounded-full"
						style={{
							backgroundColor:
								CATEGORY_COLOR_HEX_MAP[
									row.original.category.color as CategoryColor
								] || "#6b7280",
						}}
					/>
					<span className="font-medium">{row.original.category.name}</span>
				</div>
			),
		},
		{
			accessorKey: "currentPeriodTotal",
			header: () => <div className="text-right">This {periodLabel}</div>,
			enableSorting: true,
			cell: ({ row }) => (
				<div className="text-right font-medium">
					{formatCurrency(row.original.currentPeriodTotal)}
				</div>
			),
		},
		{
			id: "periodAverage",
			accessorKey: "periodAverage",
			header: () => <div className="text-right">Avg/{periodLabel}</div>,
			enableSorting: true,
			cell: ({ row }) => (
				<div className="text-right text-muted-foreground">
					{formatCurrency(row.original.periodAverage)}
				</div>
			),
		},
		{
			id: "trend",
			meta: { className: "hidden md:table-cell" },
			header: () => (
				<TooltipProvider>
					<UITooltip>
						<TooltipTrigger asChild>
							<span className="cursor-help">Trend</span>
						</TooltipTrigger>
						<TooltipContent>
							<div className="max-w-xs text-sm">
								<div className="mb-1 font-medium">Trend Analysis</div>
								<div className="space-y-1 text-xs">
									<div>
										<strong>Avg/{periodLabel}:</strong> Average of periods with
										expenses
									</div>
									<div>
										<strong>Top:</strong> Overall percentage change
									</div>
									<div>
										<strong>Bottom:</strong> {periodLabel}-over-
										{periodLabel.toLowerCase()} change
									</div>
									<div className="text-muted-foreground">
										Green ↓ = spending decreased (good)
									</div>
									<div className="text-muted-foreground">
										Red ↑ = spending increased
									</div>
								</div>
							</div>
						</TooltipContent>
					</UITooltip>
				</TooltipProvider>
			),
			enableSorting: false,
			cell: ({ row }) => {
				const item = row.original;
				return (
					<div className="flex items-center justify-center gap-3">
						{/* Sparkline Chart */}
						<div className="h-8 w-20">
							<ResponsiveContainer height="100%" width="100%">
								<LineChart
									data={item.trendData}
									margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
								>
									<XAxis dataKey="label" hide />
									<YAxis domain={["dataMin", "dataMax"]} hide />
									<Tooltip
										content={
											<SparklineTooltip formatCurrency={formatCurrency} />
										}
									/>
									<Line
										activeDot={{ r: 2 }}
										dataKey="amount"
										dot={false}
										stroke={item.isTrendingDown ? "#16a34a" : "#dc2626"}
										strokeWidth={1.5}
										type="monotone"
									/>
								</LineChart>
							</ResponsiveContainer>
						</div>

						{/* Trend Information */}
						<div className="flex min-w-0 flex-col items-center gap-1">
							{/* Overall trend */}
							<div
								className={`font-medium text-xs ${
									item.percentageChange < 0
										? "text-emerald-600"
										: item.percentageChange > 0
											? "text-red-600"
											: "text-muted-foreground"
								}`}
							>
								{item.percentageChange < 0
									? "↓"
									: item.percentageChange > 0
										? "↑"
										: "→"}
								{formatPercentage(Math.abs(item.percentageChange))}
							</div>

							{/* Period-over-period */}
							<div
								className={`text-xs ${
									item.periodOverPeriodChange < 0
										? "text-emerald-600"
										: item.periodOverPeriodChange > 0
											? "text-red-600"
											: "text-muted-foreground"
								}`}
							>
								{item.periodOverPeriodChange < 0
									? "↓"
									: item.periodOverPeriodChange > 0
										? "↑"
										: "→"}
								{formatPercentage(Math.abs(item.periodOverPeriodChange))}
							</div>
						</div>
					</div>
				);
			},
		},
	];
}

"use client";

import { differenceInDays, format } from "date-fns";
import { useId } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { formatCurrency as formatCurrencyUtil } from "~/lib/utils";

interface BudgetPacingProps {
	budgetAmount: number;
	budgetCurrency: string;
	totalSpent: number;
	currentBillingPeriod?: {
		startDate: Date;
		endDate: Date;
		label?: string | null;
	} | null;
	// Daily cumulative spend data points
	dailySpend?: Array<{
		date: string;
		cumulative: number;
	}>;
}

const chartConfig: ChartConfig = {
	actual: {
		label: "Actual Spend",
		color: "var(--color-chart-1)",
	},
	ideal: {
		label: "Ideal Pace",
		color: "#525252",
	},
};

export function BudgetPacing({
	budgetAmount,
	budgetCurrency,
	totalSpent,
	currentBillingPeriod,
	dailySpend,
}: BudgetPacingProps) {
	const id = useId();
	const { formatCurrency } = useCurrencyFormatter();

	const utilizationPct =
		budgetAmount > 0 ? (totalSpent / budgetAmount) * 100 : 0;
	const isOverBudget = utilizationPct > 100;
	const isNearBudget = utilizationPct > 80;

	// ── Time context ──────────────────────────────────────────────────────────
	const timeStart = currentBillingPeriod?.startDate
		? new Date(currentBillingPeriod.startDate)
		: null;
	const timeEnd = currentBillingPeriod?.endDate
		? new Date(currentBillingPeriod.endDate)
		: null;

	let timeContext: {
		elapsedDays: number;
		totalDays: number;
		timeProgressPct: number;
		daysRemaining: number;
		label: string;
	} | null = null;

	if (timeStart && timeEnd) {
		const today = new Date();
		const tDays = differenceInDays(timeEnd, timeStart) + 1;
		const rawElapsed = differenceInDays(today, timeStart) + 1;
		const elapsedDays = Math.min(Math.max(rawElapsed, 1), tDays);
		const timeProgressPct = (elapsedDays / tDays) * 100;
		const daysRemaining = tDays - elapsedDays;
		const periodLabel = currentBillingPeriod
			? ` · ${currentBillingPeriod.label ?? format(timeStart, "MMMM yyyy")}`
			: "";
		timeContext = {
			elapsedDays,
			totalDays: tDays,
			timeProgressPct,
			daysRemaining,
			label: `Day ${elapsedDays} of ${tDays}${periodLabel}`,
		};
	}

	// Build chart data
	const chartTotalDays = timeContext?.totalDays ?? 30;

	const chartData =
		dailySpend?.map((point, index) => ({
			...point,
			ideal: (budgetAmount / chartTotalDays) * (index + 1),
		})) ?? [];

	const areaColor = isOverBudget
		? "#ef4444"
		: isNearBudget
			? "#f59e0b"
			: "#10b981";
	const gradientId = `fillGradient-${id}`;

	const formatYAxis = (value: number) => {
		if (value >= 1000) {
			return `${formatCurrencyUtil(value / 1000, budgetCurrency, "native", false).replace(/\.00$/, "")}k`;
		}
		return formatCurrencyUtil(value, budgetCurrency, "native", false).replace(
			/\.00$/,
			"",
		);
	};

	// Daily avg and projected total (only when ≥2 days elapsed)
	const dailyAvg =
		timeContext && timeContext.elapsedDays >= 2
			? totalSpent / timeContext.elapsedDays
			: null;
	const projected =
		dailyAvg !== null && timeContext
			? dailyAvg * timeContext.totalDays
			: null;

	return (
		<Card className="border border-border bg-card shadow-sm">
			<CardHeader className="flex flex-row items-baseline justify-between px-4 pb-2 sm:px-6">
				<div>
					<CardTitle className="font-semibold text-lg tracking-tight">
						Budget Pacing
					</CardTitle>
					<p className="text-muted-foreground text-sm">
						{formatCurrency(totalSpent, budgetCurrency)} of{" "}
						{formatCurrency(budgetAmount, budgetCurrency)}
					</p>
				</div>
				<Badge
					className={
						isOverBudget
							? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
							: isNearBudget
								? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
								: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
					}
					variant="outline"
				>
					{isOverBudget
						? `${(utilizationPct - 100).toFixed(0)}% over budget`
						: `${(100 - utilizationPct).toFixed(0)}% under budget`}
				</Badge>
			</CardHeader>
			<CardContent className="px-2 pb-6 sm:px-6">
				{/* Budget progress bar */}
				<div className="mb-1">
					<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full transition-all"
							style={{
								width: `${Math.min(utilizationPct, 100)}%`,
								backgroundColor: areaColor,
							}}
						/>
					</div>
				</div>

				{/* Time progress bar */}
				{timeContext && (
					<div className="mb-4">
						<div className="mb-1 mt-2 flex items-center justify-between">
							<span className="text-muted-foreground text-xs">
								{timeContext.label}
							</span>
							<span className="text-muted-foreground text-xs">
								{timeContext.daysRemaining === 0
									? "last day"
									: `${timeContext.daysRemaining}d remaining`}
							</span>
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-muted-foreground/40 transition-all"
								style={{ width: `${Math.min(timeContext.timeProgressPct, 100)}%` }}
							/>
						</div>
						{/* Daily avg + projected */}
						{projected !== null && dailyAvg !== null && (
							<p className="mt-1.5 text-muted-foreground text-xs">
								Daily avg:{" "}
								{formatCurrency(dailyAvg, budgetCurrency)} · Projected:{" "}
								{formatCurrency(projected, budgetCurrency)} of{" "}
								{formatCurrency(budgetAmount, budgetCurrency)}
							</p>
						)}
					</div>
				)}

				{/* Chart */}
				{chartData.length > 0 && (
					<ChartContainer className="h-[200px] w-full" config={chartConfig}>
						<ComposedChart data={chartData}>
							<defs>
								<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
									<stop offset="5%" stopColor={areaColor} stopOpacity={0.8} />
									<stop offset="95%" stopColor={areaColor} stopOpacity={0.1} />
								</linearGradient>
							</defs>
							<CartesianGrid
								strokeDasharray="3 3"
								strokeOpacity={0.2}
								vertical={false}
							/>
							<XAxis
								axisLine={false}
								dataKey="date"
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
							<ChartTooltip
								content={
									<ChartTooltipContent
										formatter={(value, name) => (
											<>
												<div className="flex flex-1 items-center justify-between gap-4 leading-none">
													<span className="text-muted-foreground">
														{name === "ideal" ? "Ideal Pace" : "Actual Spend"}
													</span>
													<span className="font-semibold text-foreground tabular-nums">
														{formatCurrency(value as number, budgetCurrency)}
													</span>
												</div>
											</>
										)}
									/>
								}
							/>
							<Line
								activeDot={false}
								dataKey="ideal"
								dot={false}
								stroke="#525252"
								strokeDasharray="5 5"
								strokeWidth={2}
							/>
							<Area
								dataKey="cumulative"
								fill={`url(#${gradientId})`}
								stroke={areaColor}
								strokeWidth={2.5}
								type="monotone"
							/>
						</ComposedChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}

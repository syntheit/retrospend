"use client";

import { differenceInDays } from "date-fns";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { COLOR_TO_HEX } from "~/lib/constants";

interface CategoryStat {
	categoryId: string | null;
	name: string;
	color: string;
	total: number;
	count: number;
}

interface ProjectStatsStripProps {
	budgetAmount: number | null;
	budgetCurrency: string;
	totalSpent: number;
	currentBillingPeriod?: {
		startDate: Date;
		endDate: Date;
		label?: string | null;
	} | null;
	categories: CategoryStat[];
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

export function ProjectStatsStrip({
	budgetAmount,
	budgetCurrency,
	totalSpent,
	currentBillingPeriod,
	categories,
	currency,
}: ProjectStatsStripProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const hasBudget = budgetAmount !== null && budgetAmount > 0;

	// Budget calculations
	const utilizationPct =
		hasBudget && budgetAmount ? (totalSpent / budgetAmount) * 100 : 0;
	const isOverBudget = utilizationPct > 100;
	const isNearBudget = utilizationPct > 80;
	const remaining = hasBudget && budgetAmount ? budgetAmount - totalSpent : 0;
	const progressColor = isOverBudget
		? "#ef4444"
		: isNearBudget
			? "#f59e0b"
			: "#10b981";

	// Time context from billing period dates
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
	} | null = null;

	if (timeStart && timeEnd) {
		const today = new Date();
		const tDays = differenceInDays(timeEnd, timeStart) + 1;
		const rawElapsed = differenceInDays(today, timeStart) + 1;
		const elapsedDays = Math.min(Math.max(rawElapsed, 1), tDays);
		timeContext = {
			elapsedDays,
			totalDays: tDays,
			timeProgressPct: (elapsedDays / tDays) * 100,
			daysRemaining: tDays - elapsedDays,
		};
	}

	// Daily avg and projected (≥2 days elapsed, non-zero spend)
	const dailyAvg =
		timeContext && timeContext.elapsedDays >= 2 && totalSpent > 0
			? totalSpent / timeContext.elapsedDays
			: null;
	const projected =
		dailyAvg !== null && timeContext
			? dailyAvg * timeContext.totalDays
			: null;
	const projectedIsOver =
		hasBudget && projected !== null && budgetAmount !== null
			? projected > budgetAmount
			: false;

	// Category data with resolved hex colors
	const categoryData = categories.map((cat, i) => ({
		...cat,
		fill:
			COLOR_TO_HEX[cat.color] ??
			DEFAULT_COLORS[i % DEFAULT_COLORS.length] ??
			"#10b981",
	}));

	const showBudget = hasBudget;
	// Only show insights when budget + date range are set (projections need both)
	const showInsights = hasBudget && timeContext !== null;
	// Show categories section if budget exists (empty state) or there are actual categories
	const showCategories = hasBudget || categories.length > 0;

	return (
		<Card className="w-fit border border-border bg-card shadow-sm">
			<CardContent className="p-0">
				<div className="flex flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0">
					{/* ── Budget section ───────────────────────────────────────────── */}
					{showBudget && budgetAmount !== null && (
						<div className="flex flex-col gap-3 p-4 sm:p-5 md:min-w-[280px]">
							<div className="flex items-center justify-between">
								<span className="text-xs font-medium tracking-wide text-muted-foreground">
									Budget
								</span>
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
										? `${(utilizationPct - 100).toFixed(0)}% over`
										: `${(100 - utilizationPct).toFixed(0)}% under`}
								</Badge>
							</div>

							<div>
								<p className="text-lg font-semibold tabular-nums">
									{formatCurrency(totalSpent, budgetCurrency)}{" "}
									<span className="text-sm font-normal text-muted-foreground">
										/ {formatCurrency(budgetAmount, budgetCurrency)}
									</span>
								</p>
								<p className="text-xs text-muted-foreground">
									{remaining >= 0
										? `${formatCurrency(remaining, budgetCurrency)} remaining`
										: `${formatCurrency(Math.abs(remaining), budgetCurrency)} over budget`}
								</p>
							</div>

							{/* Budget progress bar */}
							<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full transition-all"
									style={{
										width: `${Math.min(utilizationPct, 100)}%`,
										backgroundColor: progressColor,
									}}
								/>
							</div>

							{/* Time progress */}
							{timeContext && (
								<div className="space-y-1">
									<div className="flex items-center justify-between">
										<span className="text-xs text-muted-foreground">
											Day {timeContext.elapsedDays} of {timeContext.totalDays}
										</span>
										<span className="text-xs text-muted-foreground">
											{timeContext.daysRemaining === 0
												? "last day"
												: `${timeContext.daysRemaining}d remaining`}
										</span>
									</div>
									<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
										<div
											className="h-full rounded-full bg-muted-foreground/40 transition-all"
											style={{
												width: `${Math.min(timeContext.timeProgressPct, 100)}%`,
											}}
										/>
									</div>
								</div>
							)}
						</div>
					)}

					{/* ── Spending insights section ─────────────────────────────────── */}
					{showInsights && (
						<div className="flex flex-col gap-3 p-4 sm:p-5">
							<span className="text-xs font-medium tracking-wide text-muted-foreground">
								Insights
							</span>
							<div className="flex gap-8">
								<div>
									<p className="text-xs text-muted-foreground">Daily avg</p>
									<p className="text-lg font-semibold tabular-nums">
										{dailyAvg !== null
											? formatCurrency(dailyAvg, budgetCurrency)
											: "-"}
									</p>
									<p className="text-xs text-muted-foreground">per day</p>
								</div>
								<div>
									<p className="text-xs text-muted-foreground">Projected</p>
									<p
										className={`text-lg font-semibold tabular-nums ${
											projected !== null
												? projectedIsOver
													? "text-red-500"
													: "text-emerald-500"
												: ""
										}`}
									>
										{projected !== null
											? formatCurrency(projected, budgetCurrency)
											: "-"}
									</p>
									<p className="text-xs text-muted-foreground">
										{projected !== null
											? projectedIsOver
												? "over budget"
												: "under budget"
											: "not enough data"}
									</p>
								</div>
							</div>
						</div>
					)}

					{/* ── Category breakdown section ────────────────────────────────── */}
					{showCategories && (
						<div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
							<div className="flex items-center justify-between">
								<span className="text-xs font-medium tracking-wide text-muted-foreground">
									Categories
								</span>
								{categories.length > 0 && (
									<span className="text-xs tabular-nums text-muted-foreground">
										{categories.length}
									</span>
								)}
							</div>

							{categories.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									No expenses logged yet.
								</p>
							) : (
								<>
									{/* Stacked horizontal bar */}
									<div className="flex h-1.5 w-full overflow-hidden rounded-full">
										{categoryData.map((cat) => (
											<div
												key={cat.categoryId ?? cat.name}
												style={{
													width: `${
														totalSpent > 0
															? (cat.total / totalSpent) * 100
															: 0
													}%`,
													backgroundColor: cat.fill,
												}}
											/>
										))}
									</div>

									{/* Category chips */}
									<div className="flex flex-wrap gap-1.5">
										{categoryData.map((cat) => (
											<div
												key={cat.categoryId ?? cat.name}
												className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5"
											>
												<div
													className="h-2 w-2 shrink-0 rounded-full"
													style={{ backgroundColor: cat.fill }}
												/>
												<span className="text-xs font-medium tabular-nums">
													{formatCurrency(cat.total, currency)}
												</span>
												<span className="text-xs text-muted-foreground">
													{cat.name}
												</span>
											</div>
										))}
									</div>
								</>
							)}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

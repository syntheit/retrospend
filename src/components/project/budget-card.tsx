"use client";

import { differenceInDays } from "date-fns";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

interface BudgetCardProps {
	budget: number;
	budgetCurrency: string;
	spent: number;
	startDate: Date | null;
	endDate: Date | null;
}

export function BudgetCard({
	budget,
	budgetCurrency,
	spent,
	startDate,
	endDate,
}: BudgetCardProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const utilizationPct = budget > 0 ? (spent / budget) * 100 : 0;
	const isOverBudget = utilizationPct > 100;
	const isNearBudget = utilizationPct > 80;
	const remaining = budget - spent;

	const progressColor = isOverBudget
		? "#ef4444"
		: isNearBudget
			? "#f59e0b"
			: "#10b981";

	// Time context
	let timeContext: {
		elapsedDays: number;
		totalDays: number;
		timeProgressPct: number;
		daysRemaining: number;
	} | null = null;

	if (startDate && endDate) {
		const start = new Date(startDate);
		const end = new Date(endDate);
		const today = new Date();
		const tDays = differenceInDays(end, start) + 1;
		const rawElapsed = differenceInDays(today, start) + 1;
		const elapsedDays = Math.min(Math.max(rawElapsed, 1), tDays);
		timeContext = {
			elapsedDays,
			totalDays: tDays,
			timeProgressPct: (elapsedDays / tDays) * 100,
			daysRemaining: tDays - elapsedDays,
		};
	}

	const dailyAvg =
		timeContext && timeContext.elapsedDays >= 2 && spent > 0
			? spent / timeContext.elapsedDays
			: null;
	const projected =
		dailyAvg !== null && timeContext
			? dailyAvg * timeContext.totalDays
			: null;
	const projectedIsOver = projected !== null ? projected > budget : false;

	return (
		<Card className="h-full border border-border bg-card shadow-sm">
			<CardContent className="p-4 sm:p-5">
				{/* Header */}
				<div className="mb-3 flex items-center justify-between">
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

				{/* Amount */}
				<div className="mb-3">
					<p className="text-2xl font-bold tabular-nums">
						{formatCurrency(spent, budgetCurrency)}{" "}
						<span className="text-base font-normal text-muted-foreground">
							/ {formatCurrency(budget, budgetCurrency)}
						</span>
					</p>
					<p className="text-sm text-muted-foreground">
						{remaining >= 0
							? `${formatCurrency(remaining, budgetCurrency)} remaining`
							: `${formatCurrency(Math.abs(remaining), budgetCurrency)} over budget`}
					</p>
				</div>

				{/* Budget progress bar */}
				<div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full transition-all"
						style={{
							width: `${Math.min(utilizationPct, 100)}%`,
							backgroundColor: progressColor,
						}}
					/>
				</div>

				{/* Day counter */}
				{timeContext && (
					<div className="mb-3 flex items-center justify-between">
						<span className="text-xs text-muted-foreground">
							Day {timeContext.elapsedDays} of {timeContext.totalDays}
						</span>
						<span className="text-xs text-muted-foreground">
							{timeContext.daysRemaining === 0
								? "last day"
								: `${timeContext.daysRemaining}d remaining`}
						</span>
					</div>
				)}

				{/* Pace stats - only when dates are available */}
				{timeContext && (
					<>
						<div className="my-3 border-t border-border" />
						<div className="flex gap-6">
							<div>
								<p className="text-xs font-medium tracking-wide text-muted-foreground">
									Daily Avg
								</p>
								<p className="text-lg font-bold tabular-nums">
									{dailyAvg !== null
										? formatCurrency(dailyAvg, budgetCurrency)
										: "-"}
								</p>
								<p className="text-xs text-muted-foreground">per day</p>
							</div>
							<div>
								<p className="text-xs font-medium tracking-wide text-muted-foreground">
									Projected
								</p>
								<p
									className={`text-lg font-bold tabular-nums ${
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
					</>
				)}
			</CardContent>
		</Card>
	);
}

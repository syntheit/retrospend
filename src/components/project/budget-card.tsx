"use client";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

interface BudgetCardProps {
	budget: number;
	budgetCurrency: string;
	spent: number;
}

export function BudgetCard({
	budget,
	budgetCurrency,
	spent,
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
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full transition-all"
						style={{
							width: `${Math.min(utilizationPct, 100)}%`,
							backgroundColor: progressColor,
						}}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

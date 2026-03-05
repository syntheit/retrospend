"use client";

import { PartitionBar } from "~/components/budget/partition-bar";
import { BulletChart } from "~/components/budget/bullet-chart";
import { getCategoryIcon } from "~/lib/category-icons";
import { formatCurrency } from "~/lib/currency-format";
import { cn } from "~/lib/utils";
import { DEMO_CATEGORY_BUDGETS } from "./demo-data";

function DemoBudgetRow({
	budget,
}: {
	budget: (typeof DEMO_CATEGORY_BUDGETS)[0];
}) {
	const isOverBudget = budget.actualSpend > budget.allocatedAmount;

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className="group flex w-full items-center gap-3 p-3 text-left transition-colors sm:gap-4 sm:p-4">
				<div
					className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9",
						"bg-primary/10 text-primary",
					)}
				>
					{(() => {
						const Icon = getCategoryIcon(budget.name, null);
						return <Icon className="h-4 w-4" />;
					})()}
				</div>

				<div className="min-w-0 flex-1">
					<h3 className="truncate font-medium text-sm tracking-tight sm:text-base">
						{budget.name}
					</h3>
				</div>

				<div className="max-w-[40px] flex-1 sm:max-w-xs">
					<BulletChart
						actualSpend={budget.actualSpend}
						budgetAmount={budget.allocatedAmount}
						color={budget.color}
						isOverBudget={isOverBudget}
						isPegged={budget.pegToActual}
					/>
				</div>

				<div className="flex items-center justify-end gap-1 whitespace-nowrap text-right tabular-nums">
					<span
						className={`font-medium sm:text-lg ${isOverBudget ? "text-amber-500" : "text-foreground"}`}
					>
						{formatCurrency(budget.actualSpend, "USD")}
					</span>
					<span className="text-muted-foreground text-xs sm:text-sm">
						/ {formatCurrency(budget.allocatedAmount, "USD")}
					</span>
				</div>
			</div>
		</div>
	);
}

export function DemoBudget() {
	return (
		<div className="space-y-8">
			<div className="space-y-4 pt-2">
				<PartitionBar categoryBudgets={DEMO_CATEGORY_BUDGETS} isMobile={false} />
			</div>

			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="font-semibold text-lg tracking-tight">
							Variable / Managed
						</h3>
						<p className="text-muted-foreground text-sm">
							Categories you actively monitor and adjust
						</p>
					</div>
				</div>

				<div className="space-y-2">
					{DEMO_CATEGORY_BUDGETS.filter((b) => !b.pegToActual).map((b) => (
						<DemoBudgetRow budget={b} key={b.id} />
					))}
				</div>

				<div className="flex items-center justify-between pt-4">
					<div>
						<h3 className="font-semibold text-lg tracking-tight">
							Fixed / Pegged
						</h3>
						<p className="text-muted-foreground text-sm">
							Categories that automatically match your actual spending
						</p>
					</div>
				</div>

				<div className="space-y-2">
					{DEMO_CATEGORY_BUDGETS.filter((b) => b.pegToActual).map((b) => (
						<DemoBudgetRow budget={b} key={b.id} />
					))}
				</div>
			</div>
		</div>
	);
}

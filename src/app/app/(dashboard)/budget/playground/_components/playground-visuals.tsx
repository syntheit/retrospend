"use client";

import { Landmark, PiggyBank, Receipt, Settings } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { PartitionBar } from "~/components/budget/partition-bar";
import { Button } from "~/components/ui/button";
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useFinancialProjections } from "~/hooks/use-financial-projections";
import { cn } from "~/lib/utils";
import { MetricCard } from "./metric-card";
import { usePlayground } from "./playground-context";

export function PlaygroundVisuals() {
	const { simulatedBudgets, categories, monthlyIncome } = usePlayground();
	const { formatCurrency } = useCurrencyFormatter();
	const { homeCurrency } = useCurrency();

	const projections = useFinancialProjections(simulatedBudgets, monthlyIncome);
	const {
		totalProjectedSpend,
		projectedSurplus,
		savingsRate,
		annualProjectedSavings,
		isOverBudget,
	} = projections;

	const hasIncome = monthlyIncome > 0;

	const categoryBudgets = useMemo(() => {
		return categories
			.map((cat) => ({
				id: cat.id,
				name: cat.name,
				color: cat.color,
				allocatedAmount: simulatedBudgets[cat.id] ?? 0,
				actualSpend: 0, // Not relevant for playground bar
				pegToActual: false,
			}))
			.filter((cb) => cb.allocatedAmount > 0);
	}, [categories, simulatedBudgets]);

	return (
		<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
			<MetricCard
				className="border-none bg-stone-900 text-white"
				icon={<Receipt />}
				iconClassName="text-stone-400"
				subtext={
					<div className="mt-3 flex items-center gap-2">
						<div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800">
							<div
								className={cn(
									"h-full transition-all duration-500",
									isOverBudget ? "bg-rose-500" : "bg-indigo-500",
								)}
								style={{
									width: `${Math.min((totalProjectedSpend / (monthlyIncome || totalProjectedSpend)) * 100, 100)}%`,
								}}
							/>
						</div>
						<span className="font-medium text-stone-400 text-xs">
							{hasIncome
								? `${Math.round((totalProjectedSpend / monthlyIncome) * 100)}% of Income`
								: "No Income"}
						</span>
					</div>
				}
				title="Monthly Burn"
				titleClassName="text-stone-400"
				value={formatCurrency(totalProjectedSpend, homeCurrency)}
			/>

			<MetricCard
				className="border-none bg-indigo-600 text-white"
				contentClassName={cn(!hasIncome && "min-h-[100px]")}
				headerClassName={cn(!hasIncome && "opacity-40")}
				icon={<PiggyBank />}
				iconClassName="text-indigo-200"
				overlay={
					!hasIncome && (
						<div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-indigo-600/10 p-2 text-center backdrop-blur-[2px]">
							<p className="mb-1 font-bold text-[10px] text-indigo-200 uppercase tracking-widest">
								Income Required
							</p>
							<Link href="/app/settings">
								<Button
									className="h-7 border-0 bg-white/10 px-2 text-[10px] text-white hover:bg-white/20"
									size="sm"
									variant="ghost"
								>
									Set in Settings
								</Button>
							</Link>
						</div>
					)
				}
				subtext={
					<p className="mt-1 text-indigo-200 text-xs uppercase tracking-wide">
						Projected Yearly Surplus
					</p>
				}
				title="Annual Savings"
				titleClassName="text-indigo-200"
				value={formatCurrency(annualProjectedSavings, homeCurrency)}
			/>

			<MetricCard
				className="border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
				contentClassName={cn(!hasIncome && "min-h-[100px]")}
				headerClassName={cn(!hasIncome && "opacity-40")}
				icon={<Landmark />}
				iconClassName="text-muted-foreground"
				overlay={
					!hasIncome && (
						<div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-stone-50/50 p-2 text-center backdrop-blur-[2px] dark:bg-stone-950/50">
							<p className="mb-1 font-bold text-[10px] text-muted-foreground uppercase tracking-widest">
								Unavailable
							</p>
							<Link href="/app/settings">
								<Button
									className="h-7 px-2 text-[10px]"
									size="sm"
									variant="outline"
								>
									Update Income
								</Button>
							</Link>
						</div>
					)
				}
				subtext={
					<p className="mt-1 text-muted-foreground text-xs uppercase tracking-wide">
						{projectedSurplus > 0 ? "Potential for Wealth" : "Over Budget"}
					</p>
				}
				title="Savings Rate"
				titleClassName="text-muted-foreground"
				value={
					<span
						className={cn(
							projectedSurplus > 0 ? "text-emerald-600" : "text-rose-600",
						)}
					>
						{Math.round(savingsRate)}%
					</span>
				}
			/>

			<div className="space-y-3 md:col-span-2 lg:col-span-3">
				<div className="flex items-center justify-between text-sm">
					<span className="font-semibold">Simulated Allocation</span>
					<span className="text-muted-foreground">
						Distribution by Category
					</span>
				</div>
				<PartitionBar categoryBudgets={categoryBudgets} isMobile={false} />
			</div>
		</div>
	);
}

"use client";

import { useMemo } from "react";
import { PartitionBar } from "~/components/budget/partition-bar";
import { usePlayground } from "./playground-context";
import { useFinancialProjections } from "~/hooks/use-financial-projections";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useCurrency } from "~/hooks/use-currency";
import { cn } from "~/lib/utils";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Landmark, PiggyBank, Receipt, Settings } from "lucide-react";
import { MetricCard } from "./metric-card";

export function PlaygroundVisuals() {
	const {
		simulatedBudgets,
		categories,
		monthlyIncome,
	} = usePlayground();
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
				title="Monthly Burn"
				value={formatCurrency(totalProjectedSpend, homeCurrency)}
				icon={<Receipt />}
				className="border-none bg-stone-900 text-white"
				titleClassName="text-stone-400"
				iconClassName="text-stone-400"
				subtext={
					<div className="mt-3 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800">
                            <div 
                                className={cn(
                                    "h-full transition-all duration-500",
                                    isOverBudget ? "bg-rose-500" : "bg-indigo-500"
                                )}
                                style={{ width: `${Math.min((totalProjectedSpend / (monthlyIncome || totalProjectedSpend)) * 100, 100)}%` }}
                            />
                        </div>
                        <span className="text-xs font-medium text-stone-400">
                            {hasIncome ? `${Math.round((totalProjectedSpend / monthlyIncome) * 100)}% of Income` : 'No Income'}
                        </span>
                    </div>
				}
			/>

			<MetricCard
				title="Annual Savings"
				value={formatCurrency(annualProjectedSavings, homeCurrency)}
				icon={<PiggyBank />}
				className="bg-indigo-600 text-white border-none"
				titleClassName="text-indigo-200"
				iconClassName="text-indigo-200"
				headerClassName={cn(!hasIncome && "opacity-40")}
				contentClassName={cn(!hasIncome && "min-h-[100px]")}
				subtext={
					<p className="mt-1 text-xs text-indigo-200 uppercase tracking-wide">
                        Projected Yearly Surplus
                    </p>
				}
				overlay={!hasIncome && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-indigo-600/10 p-2 text-center backdrop-blur-[2px]">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-200 mb-1">
                             Income Required
                        </p>
                        <Link href="/app/settings">
                             <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] bg-white/10 text-white hover:bg-white/20 border-0">
                                 Set in Settings
                             </Button>
                        </Link>
                    </div>
                )}
			/>

			<MetricCard
				title="Savings Rate"
				value={<span className={cn(projectedSurplus > 0 ? "text-emerald-600" : "text-rose-600")}>{Math.round(savingsRate)}%</span>}
				icon={<Landmark />}
				className="border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
				titleClassName="text-muted-foreground"
				iconClassName="text-muted-foreground"
				headerClassName={cn(!hasIncome && "opacity-40")}
				contentClassName={cn(!hasIncome && "min-h-[100px]")}
				subtext={
					<p className="mt-1 text-xs text-muted-foreground uppercase tracking-wide">
                        {projectedSurplus > 0 ? "Potential for Wealth" : "Over Budget"}
                    </p>
				}
				overlay={!hasIncome && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-stone-50/50 dark:bg-stone-950/50 p-2 text-center backdrop-blur-[2px]">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                             Unavailable
                        </p>
                         <Link href="/app/settings">
                             <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]">
                                 Update Income
                             </Button>
                        </Link>
                    </div>
                )}
			/>

            <div className="md:col-span-2 lg:col-span-3 space-y-3">
                <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">Simulated Allocation</span>
                    <span className="text-muted-foreground">Distribution by Category</span>
                </div>
                <PartitionBar categoryBudgets={categoryBudgets} isMobile={false} />
            </div>
		</div>
	);
}

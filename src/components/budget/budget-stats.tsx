import { AlertCircle, CheckCircle2, LayoutGrid, PieChart } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { useBudgetCalculations } from "~/hooks/use-budget-calculations";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { Budget } from "~/types/budget-types";

interface BudgetStatsProps {
	budgets: Budget[];
	homeCurrency: string;
}

export function BudgetStats({
	budgets,
	homeCurrency,
}: BudgetStatsProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const {
		totalAllocated,
		stats: {
			totalCategories,
			overBudgetCategories,
			underBudgetCategories,
		},
	} = useBudgetCalculations({
		budgets,
	});

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			<Card className="group relative overflow-hidden border-blue-200/50 bg-gradient-to-br from-blue-50 to-white transition-all duration-300 hover:shadow-blue-100 hover:shadow-lg dark:border-blue-900/50 dark:from-blue-950/30 dark:to-card">
				<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-blue-500/10 transition-transform duration-300 group-hover:scale-150" />
				<CardContent className="relative p-5">
					<div className="flex items-start justify-between">
						<div className="space-y-1">
							<p className="font-medium text-blue-700 text-sm dark:text-blue-400">
								Total Allocated
							</p>
							<p className="font-bold text-2xl text-blue-900 dark:text-blue-100">
								{formatCurrency(totalAllocated, homeCurrency)}
							</p>
						</div>
						<div className="rounded-lg bg-blue-100 p-2.5 dark:bg-blue-900/50">
							<PieChart className="h-5 w-5 text-blue-600 dark:text-blue-400" />
						</div>
					</div>
					<div className="mt-3 flex items-center gap-1.5 text-blue-600/80 text-sm dark:text-blue-400/80">
						<LayoutGrid className="h-3.5 w-3.5" />
						<span>{totalCategories} categories defined</span>
					</div>
				</CardContent>
			</Card>

			{overBudgetCategories > 0 ? (
				<Card className="group relative overflow-hidden border-rose-200/50 bg-gradient-to-br from-rose-50 to-white transition-all duration-300 hover:shadow-lg hover:shadow-rose-100 dark:border-rose-900/50 dark:from-rose-950/30 dark:to-card">
					<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-rose-500/10 transition-transform duration-300 group-hover:scale-150" />
					<CardContent className="relative p-5">
						<div className="flex items-start justify-between">
							<div className="space-y-1">
								<p className="font-medium text-rose-700 text-sm dark:text-rose-400">
									Budget Attention
								</p>
								<p className="font-bold text-2xl text-rose-900 dark:text-rose-100">
									{overBudgetCategories} Over
								</p>
							</div>
							<div className="rounded-lg bg-rose-100 p-2.5 dark:bg-rose-900/50">
								<AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
							</div>
						</div>
						<div className="mt-3 flex items-center gap-1.5 text-rose-600/80 text-sm dark:text-rose-400/80">
							<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
							<span>{underBudgetCategories} categories under limit</span>
						</div>
					</CardContent>
				</Card>
			) : (
				<Card className="group relative overflow-hidden border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white transition-all duration-300 hover:shadow-emerald-100 hover:shadow-lg dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-card">
					<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-500/10 transition-transform duration-300 group-hover:scale-150" />
					<CardContent className="relative p-5">
						<div className="flex items-start justify-between">
							<div className="space-y-1">
								<p className="font-medium text-emerald-700 text-sm dark:text-emerald-400">
									Budget Status
								</p>
								<p className="font-bold text-2xl text-emerald-900 dark:text-emerald-100">
									All Clear
								</p>
							</div>
							<div className="rounded-lg bg-emerald-100 p-2.5 dark:bg-emerald-900/50">
								<CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
							</div>
						</div>
						<div className="mt-3 flex items-center gap-1.5 text-emerald-600/80 text-sm dark:text-emerald-400/80">
							<CheckCircle2 className="h-3.5 w-3.5" />
							<span>All {totalCategories} categories under limit</span>
						</div>
					</CardContent>
				</Card>
			)}


		</div>
	);
}

import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";

import { useBudgetCalculations } from "~/hooks/use-budget-calculations";
import { useCurrencyConversion } from "~/hooks/use-currency-conversion";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import type { Budget } from "~/types/budget-types";

interface BudgetHeaderProps {
	selectedMonth: Date;
	homeCurrency: string;
	budgets: Budget[];
	usdToHomeCurrencyRate: number;
	serverTime?: Date;
}

export function BudgetHeader({
	selectedMonth,
	homeCurrency,
	budgets,
	usdToHomeCurrencyRate,
	serverTime,
}: BudgetHeaderProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const { fromUSD } = useCurrencyConversion();
	const {
		displayAmountInUSD,
		totalSpentInUSD,
		remainingInUSD,
		isOverBudget,
		percentUsed,
	} = useBudgetCalculations({
		budgets,
	});

	// Convert USD values to home currency using the centralized conversion function
	const displayAmountInHomeCurrency = fromUSD(
		displayAmountInUSD,
		homeCurrency,
		usdToHomeCurrencyRate,
	);
	const totalSpentInHomeCurrency = fromUSD(
		totalSpentInUSD,
		homeCurrency,
		usdToHomeCurrencyRate,
	);
	const remainingInHomeCurrency = fromUSD(
		Math.abs(remainingInUSD),
		homeCurrency,
		usdToHomeCurrencyRate,
	);

	const hasData = budgets.length > 0 || totalSpentInUSD > 0;

	// Use server time for consistent timezone handling
	const today = serverTime ?? new Date();
	const isPastMonth =
		selectedMonth.getFullYear() < today.getFullYear() ||
		(selectedMonth.getFullYear() === today.getFullYear() &&
			selectedMonth.getMonth() < today.getMonth());

	return (
		<div className="space-y-6">
			{isPastMonth && hasData && (
				<div className="flex justify-end">
					<div className="rounded-full bg-stone-100 px-4 py-1.5 font-medium text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-400">
						Monthly Wrap-up
					</div>
				</div>
			)}

			{isPastMonth ? (
				hasData ? (
					<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 shadow-2xl dark:from-indigo-900 dark:via-purple-900 dark:to-pink-900">
						<div className="absolute top-0 right-0 h-96 w-96 translate-x-20 -translate-y-20 rounded-full bg-white/10 blur-3xl" />
						<div className="absolute bottom-0 left-0 h-64 w-64 -translate-x-16 translate-y-16 rounded-full bg-white/10 blur-2xl" />

						<CardContent className="relative p-8 sm:p-12">
							<div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
								<div className="space-y-6">
									<div className="space-y-2">
										<p className="font-medium text-indigo-100 text-lg tracking-wide">
											You spent
										</p>
										<p className="font-bold text-4xl tabular-nums tracking-tighter text-white sm:text-6xl lg:text-8xl">
											{formatCurrency(totalSpentInHomeCurrency, homeCurrency)}
										</p>
									</div>

									<div className="flex flex-wrap items-center gap-4">
										<div className="flex items-center gap-2 rounded-2xl bg-white/20 px-4 py-2 backdrop-blur-md">
											<p className="font-semibold text-lg tabular-nums text-white">
												{Math.round(percentUsed)}%
											</p>
											<p className="text-sm text-white/80">of your budget</p>
										</div>
										<div
											className={cn(
												"flex items-center gap-2 rounded-2xl px-4 py-2 backdrop-blur-md",
												isOverBudget ? "bg-rose-500/30" : "bg-emerald-500/30",
											)}
										>
											{isOverBudget ? (
												<TrendingDown className="h-5 w-5 text-rose-200" />
											) : (
												<TrendingUp className="h-5 w-5 text-emerald-200" />
											)}
											<span className="font-semibold text-lg text-white">
												{isOverBudget ? "Over Budget" : "Under Control"}
											</span>
										</div>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-8 border-white/20 border-t pt-8 lg:border-t-0 lg:pt-0">
									<div className="space-y-1">
										<p className="font-medium text-sm text-white/60 tracking-wide">
											Budgeted
										</p>
										<p className="font-bold text-2xl tabular-nums text-white sm:text-3xl">
											{formatCurrency(
												displayAmountInHomeCurrency,
												homeCurrency,
											)}
										</p>
									</div>
									<div className="space-y-1">
										<p className="font-medium text-sm text-white/60 tracking-wide">
											{isOverBudget ? "Overspent" : "Surplus"}
										</p>
										<p
											className={cn(
												"font-bold text-2xl tabular-nums sm:text-3xl",
												isOverBudget ? "text-rose-200" : "text-emerald-200",
											)}
										>
											{formatCurrency(remainingInHomeCurrency, homeCurrency)}
										</p>
									</div>
								</div>
							</div>
						</CardContent>
					</Card>
				) : (
					<Card className="border-dashed bg-muted/30">
						<CardContent className="flex h-32 items-center justify-center p-6 text-center">
							<p className="text-muted-foreground">
								No budget or activity recorded for this month
							</p>
						</CardContent>
					</Card>
				)
			) : (
				<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black">
					<div className="absolute top-0 right-0 h-64 w-64 translate-x-20 -translate-y-20 rounded-full bg-white/5" />
					<div className="absolute bottom-0 left-0 h-48 w-48 -translate-x-16 translate-y-16 rounded-full bg-white/5" />

					<CardContent className="relative p-6 sm:p-8">
						<div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
							<div className="space-y-4">
								<div className="space-y-1">
									<p className="font-medium text-sm text-white/60">
										Total Monthly Budget
									</p>
									<p className="font-bold text-4xl tabular-nums tracking-tight text-white sm:text-5xl">
										{formatCurrency(displayAmountInHomeCurrency, homeCurrency)}
									</p>
								</div>

								<div className="flex flex-wrap items-center gap-3">
									<div
										className={cn(
											"flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-xs",
											isOverBudget
												? "border-rose-500/20 bg-rose-500/10 text-rose-400"
												: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
										)}
									>
										{isOverBudget ? (
											<TrendingDown className="h-3.5 w-3.5" />
										) : (
											<TrendingUp className="h-3.5 w-3.5" />
										)}
										{isOverBudget ? "Overspent" : "Under Limit"}
									</div>
									<span className="text-sm text-white/50 tabular-nums">
										{Math.round(percentUsed)}% of budget used
									</span>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4 lg:flex lg:gap-8">
								<div className="space-y-1">
									<p className="font-medium text-white/60 text-xs tracking-wide">
										Spent
									</p>
									<p className="font-semibold text-xl tabular-nums text-white">
										{formatCurrency(totalSpentInHomeCurrency, homeCurrency)}
									</p>
								</div>
								<div className="space-y-1">
									<p className="font-medium text-white/60 text-xs tracking-wide">
										{isOverBudget ? "Overage" : "Remaining"}
									</p>
									<p
										className={cn(
											"font-semibold text-xl tabular-nums",
											isOverBudget ? "text-rose-400" : "text-emerald-400",
										)}
									>
										{formatCurrency(remainingInHomeCurrency, homeCurrency)}{" "}
										<span className="text-sm opacity-70">
											{isOverBudget ? "over" : "left"}
										</span>
									</p>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

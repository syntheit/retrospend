import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronLeft,
	ChevronRight,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { useBudgetCalculations } from "~/hooks/use-budget-calculations";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { Budget, BudgetMode } from "~/types/budget-types";

interface BudgetHeaderProps {
	selectedMonth: Date;
	onNavigateMonth: (direction: "prev" | "next") => void;
	budgetMode: BudgetMode;
	homeCurrency: string;
	budgets: Budget[];
	usdToHomeCurrencyRate: number;
	hasPreviousBudgets?: boolean;
}

export function BudgetHeader({
	selectedMonth,
	onNavigateMonth,
	budgetMode,
	homeCurrency,
	budgets,
	usdToHomeCurrencyRate,
	hasPreviousBudgets,
}: BudgetHeaderProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const queryClient = useQueryClient();
	const [globalLimit, setGlobalLimit] = useState<string>("");
	const [isUpdating, setIsUpdating] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

	const { data: globalBudget } = api.budget.getGlobalBudget.useQuery({
		month: selectedMonth,
	});

	const {
		displayAmountInUSD,
		totalSpent,
		totalSpentInUSD,
		remainingInUSD,
		isOverBudget,
		percentUsed,
	} = useBudgetCalculations({
		budgets,
		globalLimit: parseFloat(globalLimit) || (globalBudget?.amount ?? 0),
		globalLimitInUSD: globalBudget?.amountInUSD ?? 0,
		budgetMode,
	});

	// Convert USD values to home currency for display
	const displayAmountInHomeCurrency =
		displayAmountInUSD * usdToHomeCurrencyRate;
	const totalSpentInHomeCurrency = totalSpentInUSD * usdToHomeCurrencyRate;
	const remainingInHomeCurrency = remainingInUSD * usdToHomeCurrencyRate;

	const upsertGlobalBudget = api.budget.upsertGlobalBudget.useMutation({
		onSuccess: () => {
			setIsUpdating(false);
			setHasUnsavedChanges(false);
			queryClient.invalidateQueries({
				queryKey: [["budget", "getGlobalBudget"]],
			});
		},
		onError: () => {
			setIsUpdating(false);
		},
	});

	const deleteGlobalBudget = api.budget.deleteGlobalBudget.useMutation({
		onSuccess: () => {
			setIsUpdating(false);
			setHasUnsavedChanges(false);
			queryClient.invalidateQueries({
				queryKey: [["budget", "getGlobalBudget"]],
			});
		},
		onError: () => {
			setIsUpdating(false);
		},
	});

	useEffect(() => {
		if (!hasUnsavedChanges && !isUpdating) {
			if (globalBudget) {
				setGlobalLimit(globalBudget.amount.toString());
			} else {
				setGlobalLimit("");
			}
		}
	}, [globalBudget, hasUnsavedChanges, isUpdating]);

	const handleLimitChange = (value: string) => {
		setGlobalLimit(value);
		setHasUnsavedChanges(true);

		setIsUpdating(true);
		const timeoutId = setTimeout(() => {
			const amount = parseFloat(value);
			if (!Number.isNaN(amount) && amount > 0) {
				upsertGlobalBudget.mutate({
					amount,
					currency: homeCurrency,
					period: selectedMonth,
				});
			} else if (value === "") {
				deleteGlobalBudget.mutate({
					period: selectedMonth,
				});
			}
		}, 500);

		return () => clearTimeout(timeoutId);
	};

	const handleLimitBlur = () => {
		if (!isUpdating) {
			const amount = parseFloat(globalLimit);
			if (!Number.isNaN(amount) && amount > 0) {
				setIsUpdating(true);
				upsertGlobalBudget.mutate({
					amount,
					currency: homeCurrency,
					period: selectedMonth,
				});
			} else if (globalLimit === "") {
				setIsUpdating(true);
				deleteGlobalBudget.mutate({
					period: selectedMonth,
				});
			}
		}
	};

	const isSumMode = budgetMode === "SUM_OF_CATEGORIES";
	const hasData = budgets.length > 0 || globalBudget !== null || totalSpent > 0;

	const today = new Date();
	const isPastMonth =
		selectedMonth.getFullYear() < today.getFullYear() ||
		(selectedMonth.getFullYear() === today.getFullYear() &&
			selectedMonth.getMonth() < today.getMonth());

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-4">
					<h1 className="font-bold text-2xl tracking-tight">
						{selectedMonth.toLocaleDateString("en-US", {
							month: "long",
							year: "numeric",
						})}
					</h1>
					<div className="flex items-center gap-1">
						<Button
							className="h-8 w-8"
							disabled={!hasPreviousBudgets}
							onClick={() => onNavigateMonth("prev")}
							size="icon"
							variant="ghost"
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<Button
							className="h-8 w-8"
							onClick={() => onNavigateMonth("next")}
							size="icon"
							variant="ghost"
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
				{isPastMonth && hasData && (
					<div className="rounded-full bg-stone-100 px-4 py-1.5 font-medium text-stone-600 text-sm dark:bg-stone-800 dark:text-stone-400">
						Monthly Wrap-up
					</div>
				)}
			</div>

			{isPastMonth ? (
				hasData ? (
					<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white shadow-2xl dark:from-indigo-900 dark:via-purple-900 dark:to-pink-900">
						<div className="absolute top-0 right-0 h-96 w-96 translate-x-20 -translate-y-20 rounded-full bg-white/10 blur-3xl" />
						<div className="absolute bottom-0 left-0 h-64 w-64 -translate-x-16 translate-y-16 rounded-full bg-white/10 blur-2xl" />

						<CardContent className="relative p-8 sm:p-12">
							<div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
								<div className="space-y-6">
									<div className="space-y-2">
										<p className="font-medium text-indigo-100 text-lg tracking-wide uppercase">
											You spent
										</p>
										<p className="font-black text-6xl tracking-tighter sm:text-7xl lg:text-8xl">
											{formatCurrency(totalSpentInHomeCurrency, homeCurrency)}
										</p>
									</div>

									<div className="flex flex-wrap items-center gap-4">
										<div className="flex items-center gap-2 rounded-2xl bg-white/20 px-4 py-2 backdrop-blur-md">
											<p className="font-semibold text-lg">
												{Math.round(percentUsed)}%
											</p>
											<p className="text-white/80 text-sm">of your budget</p>
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
											<span className="font-semibold text-lg">
												{isOverBudget ? "Over Budget" : "Under Control"}
											</span>
										</div>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-8 border-white/10 border-t pt-8 lg:border-t-0 lg:pt-0">
									<div className="space-y-1">
										<p className="font-medium text-white/60 text-sm uppercase tracking-widest">
											Budgeted
										</p>
										<p className="font-bold text-2xl sm:text-3xl">
											{formatCurrency(
												displayAmountInHomeCurrency,
												homeCurrency,
											)}
										</p>
									</div>
									<div className="space-y-1">
										<p className="font-medium text-white/60 text-sm uppercase tracking-widest">
											{isOverBudget ? "Overspent" : "Surplus"}
										</p>
										<p
											className={cn(
												"font-bold text-2xl sm:text-3xl",
												isOverBudget ? "text-rose-200" : "text-emerald-200",
											)}
										>
											{formatCurrency(
												Math.abs(remainingInHomeCurrency),
												homeCurrency,
											)}
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
				<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black">
					<div className="absolute top-0 right-0 h-64 w-64 translate-x-20 -translate-y-20 rounded-full bg-white/5" />
					<div className="absolute bottom-0 left-0 h-48 w-48 -translate-x-16 translate-y-16 rounded-full bg-white/5" />

					<CardContent className="relative p-6 sm:p-8">
						<div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
							<div className="space-y-4">
								<div className="space-y-1">
									<p className="font-medium text-sm text-stone-300">
										Total Monthly Budget
									</p>
									{isSumMode ? (
										<p className="font-bold text-4xl tracking-tight sm:text-5xl">
											{formatCurrency(
												displayAmountInHomeCurrency,
												homeCurrency,
											)}
										</p>
									) : (
										<div className="relative flex items-center">
											<span className="mr-2 font-bold text-3xl text-stone-300">
												{getCurrencySymbol(homeCurrency)}
											</span>
											<Input
												className="h-auto border-0 bg-transparent p-0 text-left font-bold text-4xl text-white tracking-tight shadow-none focus-visible:ring-0 sm:text-5xl"
												min="0"
												onBlur={handleLimitBlur}
												onChange={(e) => handleLimitChange(e.target.value)}
												placeholder="0.00"
												step="0.01"
												type="number"
												value={globalLimit}
											/>
											{isUpdating && (
												<div className="ml-4 h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
											)}
										</div>
									)}
								</div>

								<div className="flex flex-wrap items-center gap-3">
									<div
										className={cn(
											"flex items-center gap-1.5 rounded-full px-3 py-1 font-medium text-sm",
											isOverBudget
												? "bg-rose-500/20 text-rose-300"
												: "bg-emerald-500/20 text-emerald-300",
										)}
									>
										{isOverBudget ? (
											<TrendingDown className="h-3.5 w-3.5" />
										) : (
											<TrendingUp className="h-3.5 w-3.5" />
										)}
										{isOverBudget ? "Overspent" : "Under Limit"}
									</div>
									<span className="text-sm text-stone-400">
										{Math.round(percentUsed)}% of budget used
									</span>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4 lg:flex lg:gap-8">
								<div className="space-y-1">
									<p className="font-medium text-stone-400 text-xs uppercase tracking-wider">
										Spent
									</p>
									<p className="font-semibold text-xl">
										{formatCurrency(totalSpentInHomeCurrency, homeCurrency)}
									</p>
								</div>
								<div className="space-y-1">
									<p className="font-medium text-stone-400 text-xs uppercase tracking-wider">
										{isOverBudget ? "Overage" : "Remaining"}
									</p>
									<p
										className={cn(
											"font-semibold text-xl",
											isOverBudget ? "text-rose-400" : "text-emerald-400",
										)}
									>
										{formatCurrency(
											Math.abs(remainingInHomeCurrency),
											homeCurrency,
										)}
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

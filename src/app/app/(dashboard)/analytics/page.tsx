"use client";

import { BarChart3, Calendar, TrendingUp } from "lucide-react";
import { redirect, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { ActivityHeatmap } from "~/components/activity-heatmap";
import { AnalyticsSettingsModal } from "~/components/analytics-settings-modal";
import { CategoryTrendsTable } from "~/components/category-trends-table";
import { AnalyticsDateFilter } from "~/components/date/AnalyticsDateFilter";
import { DayExpensesDialog } from "~/components/day-expenses-dialog";
import { MonthlyPacingChart } from "~/components/monthly-pacing-chart";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { SpendComposition } from "~/components/spend-composition";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrency } from "~/hooks/use-currency";
import { useIsMobile } from "~/hooks/use-mobile";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import {
	cn,
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
	normalizeExpensesFromApi,
	toNumberOrNull,
	toNumberWithDefault,
} from "~/lib/utils";
import { api } from "~/trpc/react";

function getDefaultDateRange(): { from: Date; to: Date } {
	const now = new Date();
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth();
	return {
		from: new Date(currentYear, currentMonth - 5, 1),
		to: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999),
	};
}

function parseDateFromUrl(dateStr: string): Date | null {
	const parsed = new Date(dateStr);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function Page() {
	redirect("/app");
	const searchParams = useSearchParams();
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);

	const isMobile = useIsMobile();

	const dateRange = useMemo(() => {
		const fromParam = searchParams.get("from");
		const toParam = searchParams.get("to");

		if (fromParam && toParam) {
			const from = parseDateFromUrl(fromParam);
			const to = parseDateFromUrl(toParam);
			if (from && to) {
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
		}

		return getDefaultDateRange();
	}, [searchParams]);

	const { data: expensesData } = api.expense.listFinalized.useQuery({
		from: dateRange.from,
		to: dateRange.to,
	});
	const { data: budgetsData } = api.budget.getBudgets.useQuery({});
	const { data: globalBudgetData } = api.budget.getGlobalBudget.useQuery({});
	const { homeCurrency, usdToHomeRate: liveRateToBaseCurrency } = useCurrency();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const budgetMode = settings?.budgetMode ?? "GLOBAL_LIMIT";

	const { data: dayExpensesData, isLoading: isLoadingDayExpenses } =
		api.expense.getExpensesByDate.useQuery(
			{ date: selectedDate || new Date() },
			{ enabled: !!selectedDate && (dialogOpen || !isMobile) },
		);

	const expenses = useMemo<NormalizedExpense[]>(
		() => normalizeExpensesFromApi(expensesData ?? []),
		[expensesData],
	);

	const heatmapData = useMemo(() => {
		return expenses.map((expense) => {
			const datePart = expense.date.toISOString().split("T")[0] || "";
			return {
				date: datePart,
				amount: convertExpenseAmountForDisplay(
					expense,
					homeCurrency,
					liveRateToBaseCurrency,
				),
				category: expense.category?.name,
			};
		});
	}, [expenses, homeCurrency, liveRateToBaseCurrency]);

	const totalBudget = useMemo(() => {
		if (budgetMode === "SUM_OF_CATEGORIES") {
			// Sum of all category budgets
			if (!budgetsData) return undefined;
			return budgetsData.reduce(
				(total, budget) =>
					total + Number(budget.effectiveAmount ?? budget.amount),
				0,
			);
		} else {
			// Global limit mode
			if (!globalBudgetData) return undefined;
			return Number(globalBudgetData.amount);
		}
	}, [budgetsData, globalBudgetData, budgetMode]);

	const handleDayClick = (date: Date, hasActivity: boolean) => {
		if (hasActivity) {
			setSelectedDate(date);
			if (isMobile) {
				setDialogOpen(true);
			}
		} else {
			// Clear selection when clicking on empty squares
			setSelectedDate(null);
		}
	};

	const normalizedDayExpenses = useMemo(
		() =>
			(dayExpensesData ?? []).map((expense) => ({
				...expense,
				amount: toNumberWithDefault(expense.amount),
				exchangeRate: toNumberOrNull(expense.exchangeRate),
				amountInUSD: toNumberWithDefault(expense.amountInUSD),
			})),
		[dayExpensesData],
	);

	const currencyFormatter = useMemo(
		() =>
			new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: homeCurrency,
				minimumFractionDigits: 0,
				maximumFractionDigits: 0,
			}),
		[homeCurrency],
	);
	const rangeMetrics = useMemo(() => {
		const rangeTotal = expenses.reduce(
			(sum, expense) =>
				sum +
				convertExpenseAmountForDisplay(
					expense,
					homeCurrency,
					liveRateToBaseCurrency,
				),
			0,
		);

		const monthsWithExpenses = new Set(
			expenses.map(
				(expense) => `${expense.date.getFullYear()}-${expense.date.getMonth()}`,
			),
		);
		const monthlyAverage =
			monthsWithExpenses.size > 0 ? rangeTotal / monthsWithExpenses.size : 0;

		const categoryTotals = new Map<
			string,
			{ name: string; total: number; color: string }
		>();
		expenses.forEach((expense) => {
			if (expense.category) {
				const categoryName = expense.category.name;
				const amount = convertExpenseAmountForDisplay(
					expense,
					homeCurrency,
					liveRateToBaseCurrency,
				);
				const existing = categoryTotals.get(categoryName);
				categoryTotals.set(categoryName, {
					name: categoryName,
					total: (existing?.total || 0) + amount,
					color: expense.category.color,
				});
			}
		});

		let highestCategory = { name: "None", total: 0, color: "gray" };
		categoryTotals.forEach((category) => {
			if (category.total > highestCategory.total) {
				highestCategory = category;
			}
		});

		return { rangeTotal, monthlyAverage, highestCategory };
	}, [expenses, homeCurrency, liveRateToBaseCurrency]);

	return (
		<>
			<SiteHeader
				actions={
					<div className="flex items-center gap-2">
						<AnalyticsDateFilter />
						<AnalyticsSettingsModal />
					</div>
				}
				title="Analytics"
			/>

			<PageContent>
				<div className="flex flex-col gap-1">
					<p className="text-muted-foreground text-sm">
						Trends and insights from your spending.
					</p>
					<p className="text-muted-foreground text-xs">Live data only.</p>
				</div>

				{/* Compact metrics grid - more space efficient */}
				<div className="space-y-6">
					<div className="grid gap-4 md:grid-cols-3">
						{/* Year-to-Date Total - Hero metric with dark theme */}
						<Card className="group relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl transition-all duration-300 hover:shadow-2xl md:col-span-1 dark:from-stone-900 dark:via-stone-800 dark:to-black">
							<div className="absolute top-0 right-0 h-32 w-32 translate-x-12 -translate-y-12 rounded-full bg-white/5 transition-transform duration-300 group-hover:scale-150" />

							<CardContent className="relative p-5">
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<p className="font-medium text-sm text-stone-300">
											Total Spending
										</p>
										<div className="rounded-lg bg-white/10 p-2 backdrop-blur-sm">
											<TrendingUp className="h-4 w-4 text-stone-300" />
										</div>
									</div>
									<p className="font-bold text-3xl tracking-tight">
										{currencyFormatter.format(rangeMetrics.rangeTotal)}
									</p>
									<p className="text-stone-400 text-xs">Selected range</p>
								</div>
							</CardContent>
						</Card>

						{/* Monthly Average - Blue Theme */}
						<Card className="group relative overflow-hidden border-blue-200/50 bg-gradient-to-br from-blue-50 to-white transition-all duration-300 hover:shadow-blue-100 hover:shadow-lg dark:border-blue-900/50 dark:from-blue-950/30 dark:to-card">
							<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-blue-500/10 transition-transform duration-300 group-hover:scale-150" />

							<CardContent className="relative p-5">
								<div className="flex items-start justify-between">
									<div className="space-y-1">
										<p className="font-medium text-blue-700 text-sm dark:text-blue-400">
											Monthly Average
										</p>
										<p className="font-bold text-2xl text-blue-900 dark:text-blue-100">
											{currencyFormatter.format(rangeMetrics.monthlyAverage)}
										</p>
									</div>
									<div className="rounded-lg bg-blue-100 p-2.5 dark:bg-blue-900/50">
										<Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
									</div>
								</div>
							</CardContent>
						</Card>

						{/* Highest Category - Amber Theme */}
						<Card className="group relative overflow-hidden border-amber-200/50 bg-gradient-to-br from-amber-50 to-white transition-all duration-300 hover:shadow-amber-100 hover:shadow-lg dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card">
							<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-amber-500/10 transition-transform duration-300 group-hover:scale-150" />

							<CardContent className="relative p-5">
								<div className="flex items-start justify-between">
									<div className="space-y-1">
										<p className="font-medium text-amber-700 text-sm dark:text-amber-400">
											Highest Category
										</p>
										<p className="font-bold text-2xl text-amber-900 dark:text-amber-100">
											{currencyFormatter.format(
												rangeMetrics.highestCategory.total,
											)}
										</p>
									</div>
									<div className="rounded-lg bg-amber-100 p-2.5 dark:bg-amber-900/50">
										<BarChart3 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
									</div>
								</div>

								{/* Category name subtitle */}
								{rangeMetrics.highestCategory.name !== "None" && (
									<div className="mt-3 flex items-center gap-1.5 text-amber-600/80 text-sm dark:text-amber-400/80">
										<span
											className={cn(
												"rounded px-2 py-0.5 font-medium text-xs",
												CATEGORY_COLOR_MAP[
													rangeMetrics.highestCategory
														.color as keyof typeof CATEGORY_COLOR_MAP
												] || "bg-gray-100 text-gray-800",
											)}
										>
											{rangeMetrics.highestCategory.name}
										</span>
									</div>
								)}
							</CardContent>
						</Card>
					</div>

					{/* Bento Grid Layout */}
					<div className="grid w-full max-w-full gap-6">
						{/* Row 1: Activity Heatmap - Desktop only (hidden on mobile via CSS) */}
						<div className="hidden w-full md:block">
							<Card>
								<CardContent className="p-6">
									<div className="grid gap-6 lg:grid-cols-2">
										<div>
											<ActivityHeatmap
												data={heatmapData}
												endDate={dateRange.to}
												onDayClick={handleDayClick}
												startDate={dateRange.from}
											/>
										</div>
										<div className="flex h-[250px] flex-col border-l pl-6">
											{!selectedDate ? (
												<div className="flex flex-1 items-center justify-center">
													<div className="text-center text-muted-foreground">
														Click on a colored square to view expenses for that
														day
													</div>
												</div>
											) : isLoadingDayExpenses ? (
												<div className="flex flex-1 items-center justify-center">
													<div className="text-muted-foreground">
														Loading expenses...
													</div>
												</div>
											) : (
												<div className="flex h-full flex-col overflow-hidden">
													<h3 className="mb-4 font-semibold text-lg">
														{selectedDate.toLocaleDateString("en-US", {
															weekday: "long",
															year: "numeric",
															month: "long",
															day: "numeric",
														})}
													</h3>
													{normalizedDayExpenses.length === 0 ? (
														<div className="text-muted-foreground">
															No expenses recorded for this day.
														</div>
													) : (
														<>
															<div className="mb-4 text-muted-foreground text-sm">
																{normalizedDayExpenses.length} expense
																{normalizedDayExpenses.length === 1 ? "" : "s"}{" "}
																totaling{" "}
																<span className="font-semibold">
																	{new Intl.NumberFormat("en-US", {
																		style: "currency",
																		currency: homeCurrency,
																	}).format(
																		normalizedDayExpenses.reduce(
																			(sum, expense) =>
																				sum +
																				(expense.amountInUSD || expense.amount),
																			0,
																		),
																	)}
																</span>
															</div>
															<div className="flex-1 space-y-3 overflow-y-auto pr-2">
																{normalizedDayExpenses.map((expense) => (
																	<div
																		className="flex items-start justify-between rounded-lg border bg-muted/30 p-3"
																		key={expense.id}
																	>
																		<div className="min-w-0 flex-1">
																			<div className="mb-1 flex items-center gap-2">
																				<h4 className="truncate font-medium text-sm">
																					{expense.title}
																				</h4>
																				{expense.category && (
																					<div
																						className={cn(
																							"rounded px-2 py-0.5 font-medium text-xs",
																							CATEGORY_COLOR_MAP[
																								expense.category
																									.color as keyof typeof CATEGORY_COLOR_MAP
																							] || "bg-gray-100 text-gray-800",
																						)}
																					>
																						{expense.category.name}
																					</div>
																				)}
																			</div>
																			<div className="flex items-center gap-3 text-muted-foreground text-xs">
																				<span>
																					{new Intl.NumberFormat("en-US", {
																						style: "currency",
																						currency: expense.currency,
																					}).format(expense.amount)}
																					{expense.currency !== "USD" && (
																						<span className="ml-1">
																							(
																							{new Intl.NumberFormat("en-US", {
																								style: "currency",
																								currency: homeCurrency,
																							}).format(
																								expense.amountInUSD ||
																									expense.amount,
																							)}
																							)
																						</span>
																					)}
																				</span>
																				{expense.location && (
																					<span className="truncate">
																						📍 {expense.location}
																					</span>
																				)}
																				<span>
																					{expense.date.toLocaleTimeString(
																						"en-US",
																						{
																							hour: "numeric",
																							minute: "2-digit",
																							hour12: true,
																						},
																					)}
																				</span>
																			</div>
																			{expense.description && (
																				<p className="mt-1 truncate text-muted-foreground text-xs">
																					{expense.description}
																				</p>
																			)}
																		</div>
																	</div>
																))}
															</div>
														</>
													)}
												</div>
											)}
										</div>
									</div>
								</CardContent>
							</Card>
						</div>

						{/* Row 2: Monthly Pacing and Spend Composition (Two columns) */}
						<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
							<div className="min-w-0 max-w-full">
								<Card className="min-w-0 max-w-full">
									<CardContent className="min-w-0 p-6">
										<MonthlyPacingChart
											baseCurrency={homeCurrency}
											dateRange={dateRange}
											expenses={expenses}
											liveRateToBaseCurrency={liveRateToBaseCurrency}
											totalBudget={totalBudget}
										/>
									</CardContent>
								</Card>
							</div>
							<div className="min-w-0 max-w-full">
								<Card className="min-w-0 max-w-full">
									<CardContent className="min-w-0 p-6">
										<SpendComposition
											baseCurrency={homeCurrency}
											expenses={expenses}
											liveRateToBaseCurrency={liveRateToBaseCurrency}
										/>
									</CardContent>
								</Card>
							</div>
						</div>

						{/* Row 3: Category Trends Table */}
						<div className="w-full min-w-0 max-w-full">
							<Card className="min-w-0">
								<CardContent className="p-6">
									<CategoryTrendsTable
										baseCurrency={homeCurrency}
										dateRange={dateRange}
										expenses={expenses}
										liveRateToBaseCurrency={liveRateToBaseCurrency}
									/>
								</CardContent>
							</Card>
						</div>
					</div>
				</div>
			</PageContent>

			{isMobile && (
				<DayExpensesDialog
					baseCurrency={homeCurrency}
					expenses={normalizedDayExpenses}
					isLoading={isLoadingDayExpenses}
					liveRateToBaseCurrency={liveRateToBaseCurrency}
					onOpenChange={setDialogOpen}
					open={dialogOpen}
					selectedDate={selectedDate}
				/>
			)}
		</>
	);
}

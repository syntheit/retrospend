"use client";

import { useMemo, useState } from "react";

import { ActivityHeatmap } from "~/components/activity-heatmap";
import { AnalyticsSettingsModal } from "~/components/analytics-settings-modal";
import { CategoryTrendsTable } from "~/components/category-trends-table";
import { DayExpensesDialog } from "~/components/day-expenses-dialog";
import { MonthlyPacingChart } from "~/components/monthly-pacing-chart";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { SpendComposition } from "~/components/spend-composition";
import { Card, CardContent } from "~/components/ui/card";
import { useIsMobile } from "~/hooks/use-mobile";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import {
	cn,
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
	normalizeExpensesFromApi,
} from "~/lib/utils";
import { api } from "~/trpc/react";

export default function Page() {
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);

	const isMobile = useIsMobile();

	const { data: expensesData } = api.expense.listFinalized.useQuery();
	const { data: budgetsData } = api.budget.getBudgets.useQuery({});
	const { data: globalBudgetData } = api.budget.getGlobalBudget.useQuery({});
	const { data: settings } = api.user.getSettings.useQuery();

	const homeCurrency = settings?.homeCurrency ?? "USD";
	const budgetMode = settings?.budgetMode ?? "GLOBAL_LIMIT";
	const { data: baseCurrencyRate } =
		api.exchangeRate.getRatesForCurrency.useQuery(
			{ currency: homeCurrency },
			{ enabled: homeCurrency !== "USD" },
		);

	// Get the exchange rate from USD to base currency (prefers "blue" then "official")
	const liveRateToBaseCurrency = useMemo(() => {
		if (homeCurrency === "USD") return null;
		if (!baseCurrencyRate?.length) return null;

		const blueRate = baseCurrencyRate.find((r) => r.type === "blue");
		if (blueRate) return Number(blueRate.rate);

		const officialRate = baseCurrencyRate.find((r) => r.type === "official");
		if (officialRate) return Number(officialRate.rate);

		return Number(baseCurrencyRate[0]?.rate) || null;
	}, [baseCurrencyRate, homeCurrency]);

	const { data: dayExpensesData, isLoading: isLoadingDayExpenses } =
		api.expense.getExpensesByDate.useQuery(
			{ date: selectedDate || new Date() },
			{ enabled: !!selectedDate && (dialogOpen || !isMobile) },
		);

	const expenses = useMemo<NormalizedExpense[]>(
		() => normalizeExpensesFromApi(expensesData ?? []),
		[expensesData],
	);

	const expensesInRange = expenses;

	// Prepare data for ActivityHeatmap (annual spending)
	const heatmapData = useMemo(() => {
		const currentYear = new Date().getFullYear();
		const yearStart = new Date(currentYear, 0, 1);
		const yearEnd = new Date(currentYear, 11, 31);

		return expensesInRange
			.filter((expense) => expense.date >= yearStart && expense.date <= yearEnd)
			.map((expense) => ({
				date: expense.date.toISOString().split("T")[0]!, // YYYY-MM-DD format
				amount: convertExpenseAmountForDisplay(
					expense,
					homeCurrency,
					liveRateToBaseCurrency,
				),
				category: expense.category?.name,
			}));
	}, [expensesInRange, homeCurrency, liveRateToBaseCurrency]);

	const totalBudget = useMemo(() => {
		if (budgetMode === "SUM_OF_CATEGORIES") {
			// Sum of all category budgets
			if (!budgetsData) return undefined;
			return budgetsData.reduce(
				(total, budget) => total + Number(budget.effectiveAmount ?? budget.amount),
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

	const normalizedDayExpenses = useMemo(() => {
		return (dayExpensesData ?? []).map((expense) => ({
			...expense,
			amount:
				typeof expense.amount?.toNumber === "function"
					? expense.amount.toNumber()
					: Number(expense.amount),
			exchangeRate:
				typeof expense.exchangeRate?.toNumber === "function"
					? expense.exchangeRate.toNumber()
					: Number(expense.exchangeRate) || null,
			amountInUSD:
				typeof expense.amountInUSD?.toNumber === "function"
					? expense.amountInUSD.toNumber()
					: Number(expense.amountInUSD),
		}));
	}, [dayExpensesData]);

	return (
		<>
			<SiteHeader
				title="Analytics"
				actions={<AnalyticsSettingsModal />}
			/>

			<PageContent>
				<div className="flex flex-col gap-1">
					<p className="text-muted-foreground text-sm">
						Trends and insights from your spending.
					</p>
					<p className="text-muted-foreground text-xs">
						Live data only.
					</p>
				</div>

				{/* Bento Grid Layout */}
				<div className="grid gap-6">
					{/* Row 1: Activity Heatmap */}
					<div className="w-full">
						<Card>
							<CardContent className="p-6">
								<div className="grid gap-6 lg:grid-cols-2">
									<div>
										<ActivityHeatmap
											data={heatmapData}
											onDayClick={handleDayClick}
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
																	currency: "USD",
																}).format(
																	normalizedDayExpenses.reduce(
																		(sum, expense) =>
																			sum +
																			(expense.amountInUSD ?? expense.amount),
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
																							currency: "USD",
																						}).format(
																							expense.amountInUSD ??
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
						<Card>
							<CardContent className="p-6">
								<MonthlyPacingChart
									baseCurrency={homeCurrency}
									expenses={expensesInRange}
									liveRateToBaseCurrency={liveRateToBaseCurrency}
									totalBudget={totalBudget}
								/>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-6">
								<SpendComposition
									baseCurrency={homeCurrency}
									expenses={expensesInRange}
									liveRateToBaseCurrency={liveRateToBaseCurrency}
								/>
							</CardContent>
						</Card>
					</div>

					{/* Row 3: Category Trends Table */}
					<div className="w-full">
						<Card>
							<CardContent className="p-6">
								<CategoryTrendsTable
									baseCurrency={homeCurrency}
									expenses={expensesInRange}
									liveRateToBaseCurrency={liveRateToBaseCurrency}
								/>
							</CardContent>
						</Card>
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

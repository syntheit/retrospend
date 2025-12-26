"use client";

import { useMemo, useState } from "react";

import { ActivityHeatmap } from "~/components/activity-heatmap";
import { CategoryTrendsTable } from "~/components/category-trends-table";
import { DayExpensesDialog } from "~/components/day-expenses-dialog";
import { MonthlyPacingChart } from "~/components/monthly-pacing-chart";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { SpendComposition } from "~/components/spend-composition";
import { useIsMobile } from "~/hooks/use-mobile";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn, type NormalizedExpense, normalizeExpenses } from "~/lib/utils";
import { api } from "~/trpc/react";

type TimeRange = "3m" | "6m" | "ytd" | "all";


const timeRangeOptions: { value: TimeRange; label: string }[] = [
	{ value: "3m", label: "Last 3 Months" },
	{ value: "6m", label: "Last 6 Months" },
	{ value: "ytd", label: "Year to Date" },
	{ value: "all", label: "All Time" },
];


const getRangeStart = (timeRange: TimeRange, reference: Date) => {
	if (timeRange === "all") return new Date(0);
	if (timeRange === "ytd") return new Date(reference.getFullYear(), 0, 1);

	const start = new Date(reference);
	const monthsBack = timeRange === "3m" ? 2 : 5;
	start.setMonth(start.getMonth() - monthsBack, 1);
	return start;
};

export default function Page() {
	const [timeRange, setTimeRange] = useState<TimeRange>("6m");
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);

	const isMobile = useIsMobile();

	const { data: expensesData } = api.expense.listFinalized.useQuery();

	const { data: dayExpensesData, isLoading: isLoadingDayExpenses } =
		api.expense.getExpensesByDate.useQuery(
			{ date: selectedDate! },
			{ enabled: !!selectedDate && (dialogOpen || !isMobile) }
		);


	const expenses = useMemo<NormalizedExpense[]>(
		() =>
			normalizeExpenses(
				(expensesData ?? []).map((expense) => ({
					...expense,
					amount:
						typeof expense.amount?.toNumber === "function"
							? expense.amount.toNumber()
							: Number(expense.amount),
					exchangeRate:
						typeof expense.exchangeRate?.toNumber === "function"
							? expense.exchangeRate.toNumber()
							: Number(expense.exchangeRate),
					amountInUSD:
						typeof expense.amountInUSD?.toNumber === "function"
							? expense.amountInUSD.toNumber()
							: Number(expense.amountInUSD),
				})),
			),
		[expensesData],
	);

	const latestExpenseDate = useMemo(() => {
		if (!expenses.length) return new Date();
		return expenses
			.map((expense) => expense.date)
			.reduce((latest, current) => (current > latest ? current : latest));
	}, [expenses]);

	const rangeStart = useMemo(
		() => getRangeStart(timeRange, latestExpenseDate),
		[timeRange, latestExpenseDate],
	);

	const expensesInRange = useMemo(
		() => expenses.filter((expense) => expense.date >= rangeStart),
		[expenses, rangeStart],
	);


	// Prepare data for ActivityHeatmap (annual spending)
	const heatmapData = useMemo(() => {
		const currentYear = new Date().getFullYear();
		const yearStart = new Date(currentYear, 0, 1);
		const yearEnd = new Date(currentYear, 11, 31);

		return expenses
			.filter(expense => expense.date >= yearStart && expense.date <= yearEnd)
			.map(expense => ({
				date: expense.date.toISOString().split('T')[0]!, // YYYY-MM-DD format
				amount: expense.amountInUSD ?? expense.amount,
				category: expense.category?.name,
			}));
	}, [expenses]);

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
			amountInUSD:
				typeof expense.amountInUSD?.toNumber === "function"
					? expense.amountInUSD.toNumber()
					: Number(expense.amountInUSD),
		}));
	}, [dayExpensesData]);

	return (
		<>
			<SiteHeader
				actions={
					<div className="flex items-center gap-2">
						<span className="text-muted-foreground text-sm">Time range</span>
						<Select
							defaultValue="6m"
							onValueChange={(value) => setTimeRange(value as TimeRange)}
							value={timeRange}
						>
							<SelectTrigger className="w-full sm:w-[160px]">
								<SelectValue placeholder="Last 6 Months" />
							</SelectTrigger>
							<SelectContent>
								{timeRangeOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				}
				title="Analytics"
			/>

			<PageContent>
				<div className="flex flex-col gap-1">
					<p className="text-muted-foreground text-sm">
						Trends and insights from your spending.
					</p>
					<p className="text-muted-foreground text-xs">
						Live data only. Adjust the time range to reshape the charts.
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
										<ActivityHeatmap data={heatmapData} onDayClick={handleDayClick} />
									</div>
									<div className="flex h-[250px] flex-col border-l pl-6">
										{!selectedDate ? (
											<div className="flex flex-1 items-center justify-center">
												<div className="text-center text-muted-foreground">
													Click on a colored square to view expenses for that day
												</div>
											</div>
										) : isLoadingDayExpenses ? (
											<div className="flex flex-1 items-center justify-center">
												<div className="text-muted-foreground">Loading expenses...</div>
											</div>
										) : (
											<div className="flex h-full flex-col overflow-hidden">
												<h3 className="mb-4 text-lg font-semibold">
													{selectedDate.toLocaleDateString("en-US", {
															weekday: 'long',
															year: 'numeric',
															month: 'long',
															day: 'numeric'
														})}
													</h3>
												{normalizedDayExpenses.length === 0 ? (
													<div className="text-muted-foreground">
														No expenses recorded for this day.
													</div>
												) : (
													<>
														<div className="mb-4 text-sm text-muted-foreground">
															{normalizedDayExpenses.length} expense
															{normalizedDayExpenses.length === 1 ? "" : "s"} totaling{" "}
															<span className="font-semibold">
																{new Intl.NumberFormat("en-US", {
																	style: "currency",
																	currency: "USD",
																}).format(
																	normalizedDayExpenses.reduce(
																		(sum, expense) => sum + (expense.amountInUSD ?? expense.amount),
																		0,
																	),
																)}
															</span>
														</div>
														<div className="flex-1 space-y-3 overflow-y-auto pr-2">
															{normalizedDayExpenses.map((expense) => (
																<div
																	key={expense.id}
																	className="flex items-start justify-between rounded-lg border bg-muted/30 p-3"
																>
																	<div className="min-w-0 flex-1">
																		<div className="mb-1 flex items-center gap-2">
																			<h4 className="truncate text-sm font-medium">
																				{expense.title}
																			</h4>
																			{expense.category && (
																				<div
																					className={cn(
																						"rounded px-2 py-0.5 text-xs font-medium",
																						CATEGORY_COLOR_MAP[
																							expense.category.color as keyof typeof CATEGORY_COLOR_MAP
																						] || "bg-gray-100 text-gray-800"
																					)}
																				>
																					{expense.category.name}
																				</div>
																			)}
																		</div>
																		<div className="flex items-center gap-3 text-xs text-muted-foreground">
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
																						}).format(expense.amountInUSD ?? expense.amount)}
																						)
																					</span>
																				)}
																			</span>
																			{expense.location && (
																				<span className="truncate">📍 {expense.location}</span>
																			)}
																			<span>
																				{expense.date.toLocaleTimeString("en-US", {
																					hour: "numeric",
																					minute: "2-digit",
																					hour12: true,
																				})}
																			</span>
																		</div>
																		{expense.description && (
																			<p className="mt-1 truncate text-xs text-muted-foreground">
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
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<Card>
							<CardContent className="p-6">
								<MonthlyPacingChart expenses={expensesInRange} />
							</CardContent>
						</Card>
						<Card>
							<CardContent className="p-6">
								<SpendComposition expenses={expensesInRange} />
							</CardContent>
						</Card>
					</div>

					{/* Row 3: Category Trends Table */}
					<div className="w-full">
						<Card>
							<CardContent className="p-6">
								<CategoryTrendsTable expenses={expensesInRange} />
							</CardContent>
						</Card>
					</div>
				</div>
			</PageContent>

			{isMobile && (
				<DayExpensesDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					selectedDate={selectedDate}
					expenses={normalizedDayExpenses}
					isLoading={isLoadingDayExpenses}
				/>
			)}
		</>
	);
}

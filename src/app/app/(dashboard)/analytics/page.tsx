"use client";

import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Label,
	Pie,
	PieChart,
	XAxis,
	YAxis,
} from "recharts";

import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { type NormalizedExpense, normalizeExpenses } from "~/lib/utils";
import { api } from "~/trpc/react";

type TimeRange = "3m" | "6m" | "ytd" | "all";

type MonthlySpendPoint = {
	month: string;
	[key: string]: string | number;
};

type CurrencySlice = {
	currency: string;
	value: number;
	key: string;
	color: string;
};

const timeRangeOptions: { value: TimeRange; label: string }[] = [
	{ value: "3m", label: "Last 3 Months" },
	{ value: "6m", label: "Last 6 Months" },
	{ value: "ytd", label: "Year to Date" },
	{ value: "all", label: "All Time" },
];

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const percentFormatter = new Intl.NumberFormat("en-US", {
	style: "percent",
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
});

const chartPalette = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

const parseMonth = (value: string) => new Date(`${value}-01T00:00:00`);
const formatMonthLabel = (value: string) =>
	monthFormatter.format(parseMonth(value));
const monthKey = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

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

	const { data: expensesData } = api.expense.listFinalized.useQuery();
	const { data: settings } = api.user.getSettings.useQuery();

	const homeCurrency = settings?.homeCurrency ?? "USD";
	const usdFormatter = useMemo(
		() =>
			new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: homeCurrency,
				maximumFractionDigits: 0,
			}),
		[homeCurrency],
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

	const monthlyTotals = useMemo(() => {
		type MonthBucket = {
			usdTotal: number;
			perCurrencyDefault: Record<string, number>;
			perCurrencyOriginal: Record<string, number>;
			perCategory: Record<string, number>;
		};

		const buckets = new Map<string, MonthBucket>();

		for (const expense of expensesInRange) {
			const key = monthKey(expense.date);
			const bucket = buckets.get(key) ?? {
				usdTotal: 0,
				perCurrencyDefault: {},
				perCurrencyOriginal: {},
				perCategory: {},
			};

			const defaultAmount =
				expense.amountInUSD ??
				(expense.currency === homeCurrency ? expense.amount : 0);

			bucket.usdTotal += defaultAmount;
			bucket.perCurrencyDefault[expense.currency] =
				(bucket.perCurrencyDefault[expense.currency] ?? 0) + defaultAmount;
			bucket.perCurrencyOriginal[expense.currency] =
				(bucket.perCurrencyOriginal[expense.currency] ?? 0) + expense.amount;

			const categoryKey = expense.category?.id ?? "uncategorized";
			bucket.perCategory[categoryKey] =
				(bucket.perCategory[categoryKey] ?? 0) + defaultAmount;

			buckets.set(key, bucket);
		}

		return buckets;
	}, [homeCurrency, expensesInRange]);

	const sortedMonths = useMemo(
		() => Array.from(monthlyTotals.keys()).sort(),
		[monthlyTotals],
	);

	const currencyTotals = useMemo(() => {
		const totals = new Map<string, number>();
		for (const bucket of monthlyTotals.values()) {
			for (const [currency, total] of Object.entries(
				bucket.perCurrencyDefault,
			)) {
				totals.set(currency, (totals.get(currency) ?? 0) + total);
			}
		}
		return totals;
	}, [monthlyTotals]);

	const primaryLocalCurrency = useMemo(() => {
		let topCurrency: string | null = null;
		let topValue = 0;
		for (const [currency, total] of currencyTotals.entries()) {
			if (currency === homeCurrency) continue;
			if (total > topValue) {
				topValue = total;
				topCurrency = currency;
			}
		}
		return topCurrency;
	}, [currencyTotals, homeCurrency]);

	const { monthlySpendSeries, spendingChartConfig } = useMemo(() => {
		const categoryTotals = new Map<string, number>();
		const categoryLabels = new Map<string, string>();

		for (const expense of expensesInRange) {
			const key = expense.category?.id ?? "uncategorized";
			categoryTotals.set(
				key,
				(categoryTotals.get(key) ?? 0) +
					(expense.amountInUSD ??
						(expense.currency === homeCurrency ? expense.amount : 0)),
			);
			if (!categoryLabels.has(key)) {
				categoryLabels.set(key, expense.category?.name ?? "Uncategorized");
			}
		}

		const orderedCategories = Array.from(categoryTotals.entries())
			.sort(([, a], [, b]) => b - a)
			.map(([key]) => key);

		const series = sortedMonths.map((month) => {
			const bucket = monthlyTotals.get(month);
			const entry: MonthlySpendPoint = { month };
			for (const categoryKey of orderedCategories) {
				entry[categoryKey] = bucket?.perCategory[categoryKey] ?? 0;
			}
			return entry;
		});

		const config: ChartConfig = {};
		orderedCategories.forEach((key, index) => {
			config[key] = {
				label: categoryLabels.get(key),
				color: chartPalette[index % chartPalette.length],
			};
		});

		return { monthlySpendSeries: series, spendingChartConfig: config };
	}, [homeCurrency, expensesInRange, monthlyTotals, sortedMonths]);

	const currencySlices = useMemo<CurrencySlice[]>(() => {
		const entries = Array.from(currencyTotals.entries()).sort(
			([, a], [, b]) => b - a,
		);
		return entries.map(([currency, value], index) => {
			const key = currency.toLowerCase();
			return {
				currency,
				value,
				key,
				// biome-ignore lint/style/noNonNullAssertion: Modulo ensures index is within chartPalette bounds
				color: chartPalette[index % chartPalette.length]!,
			};
		});
	}, [currencyTotals]);

	const currencyChartConfig = useMemo(
		() =>
			currencySlices.reduce<ChartConfig>((config, slice) => {
				config[slice.key] = { label: slice.currency, color: slice.color };
				return config;
			}, {}),
		[currencySlices],
	);

	const currencyTotal = useMemo(
		() => currencySlices.reduce((sum, slice) => sum + slice.value, 0),
		[currencySlices],
	);

	const totalMonths = sortedMonths.length || 1;
	const averageBurn =
		Array.from(monthlyTotals.values()).reduce(
			(sum, bucket) => sum + bucket.usdTotal,
			0,
		) / totalMonths;

	const localChange = useMemo(() => {
		if (!primaryLocalCurrency || sortedMonths.length < 2) return null;
		// biome-ignore lint/style/noNonNullAssertion: Length check ensures array access is safe
		const last = monthlyTotals.get(sortedMonths[sortedMonths.length - 1]!);
		// biome-ignore lint/style/noNonNullAssertion: Length check ensures array access is safe
		const prev = monthlyTotals.get(sortedMonths[sortedMonths.length - 2]!);
		const lastTotal = last?.perCurrencyDefault[primaryLocalCurrency] ?? 0;
		const prevTotal = prev?.perCurrencyDefault[primaryLocalCurrency] ?? 0;

		if (prevTotal === 0) return null;
		return (lastTotal - prevTotal) / prevTotal;
	}, [monthlyTotals, primaryLocalCurrency, sortedMonths]);

	const hasAnyData = expensesInRange.length > 0;

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

				<section className="grid gap-4 xl:grid-cols-3">
					<Card>
						<CardHeader>
							<CardTitle className="font-semibold text-lg">
								Currency Exposure
							</CardTitle>
							<CardDescription>
								Share of spend by original currency ({homeCurrency} equivalent)
							</CardDescription>
						</CardHeader>
						<CardContent>
							{!hasAnyData ? (
								<div className="rounded-lg border bg-muted/40 p-4 text-muted-foreground text-sm">
									Add expenses to see currency exposure.
								</div>
							) : (
								<>
									<ChartContainer
										className="mx-auto aspect-square max-w-xs sm:max-w-sm"
										config={currencyChartConfig}
									>
										<PieChart>
											<Pie
												data={currencySlices}
												dataKey="value"
												innerRadius={70}
												nameKey="currency"
												outerRadius={120}
												paddingAngle={2}
												strokeWidth={3}
											>
												{currencySlices.map((slice) => (
													<Cell
														fill={slice.color}
														key={slice.currency}
														stroke="var(--background)"
													/>
												))}
												<Label
													content={({ viewBox }) => {
														if (
															viewBox &&
															"cx" in viewBox &&
															"cy" in viewBox &&
															typeof viewBox.cx === "number" &&
															typeof viewBox.cy === "number"
														) {
															return (
																<text
																	className="fill-foreground"
																	dominantBaseline="middle"
																	textAnchor="middle"
																	x={viewBox.cx}
																	y={viewBox.cy}
																>
																	<tspan
																		className="fill-muted-foreground text-xs"
																		dy="-0.4em"
																		x={viewBox.cx}
																	>
																		Total ({homeCurrency})
																	</tspan>
																	<tspan
																		className="font-semibold text-lg"
																		dy="1.2em"
																		x={viewBox.cx}
																	>
																		{usdFormatter.format(currencyTotal)}
																	</tspan>
																</text>
															);
														}
														return null;
													}}
													position="center"
												/>
											</Pie>
										</PieChart>
									</ChartContainer>
									<div className="mt-4 grid gap-2 text-sm">
										{currencySlices.map((slice) => (
											<div
												className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2"
												key={slice.currency}
											>
												<div className="flex items-center gap-2">
													<span
														className="h-3 w-3 rounded-sm"
														style={{ backgroundColor: slice.color }}
													/>
													<span className="text-muted-foreground">
														{slice.currency}
													</span>
												</div>
												<div className="flex items-center gap-2">
													<span className="font-semibold">
														{usdFormatter.format(slice.value)}
													</span>
													<span className="text-muted-foreground text-xs">
														{currencyTotal
															? percentFormatter.format(
																	slice.value / currencyTotal,
																)
															: "0%"}
													</span>
												</div>
											</div>
										))}
									</div>
								</>
							)}
						</CardContent>
					</Card>
				</section>

				<section className="grid gap-4 xl:grid-cols-3">
					<Card className="xl:col-span-2">
						<CardHeader>
							<CardTitle className="font-semibold text-lg">
								Monthly Spend Breakdown
							</CardTitle>
							<CardDescription>
								Stacked by category, normalized to {homeCurrency}
							</CardDescription>
						</CardHeader>
						<CardContent className="px-2 pb-6 sm:px-6">
							{!hasAnyData ? (
								<div className="rounded-lg border bg-muted/40 p-4 text-muted-foreground text-sm">
									Add expenses to view the breakdown.
								</div>
							) : (
								<ChartContainer
									className="h-[360px] w-full"
									config={spendingChartConfig}
								>
									<BarChart data={monthlySpendSeries}>
										<CartesianGrid vertical={false} />
										<XAxis
											axisLine={false}
											dataKey="month"
											minTickGap={20}
											tickFormatter={formatMonthLabel}
											tickLine={false}
											tickMargin={8}
										/>
										<YAxis
											axisLine={false}
											tickFormatter={(value) =>
												usdFormatter.format(value as number)
											}
											tickLine={false}
											width={42}
										/>
										<ChartTooltip
											content={
												<ChartTooltipContent
													formatter={(value, name) => (
														<div className="flex w-full justify-between">
															<span className="text-muted-foreground">
																{name as string}
															</span>
															<span className="font-medium">
																{usdFormatter.format(value as number)}
															</span>
														</div>
													)}
													indicator="dot"
													labelFormatter={(value) =>
														formatMonthLabel(value as string)
													}
												/>
											}
										/>
										<ChartLegend
											content={<ChartLegendContent className="justify-start" />}
											verticalAlign="top"
										/>
										{Object.keys(spendingChartConfig).map((key, index, arr) => (
											<Bar
												dataKey={key}
												fill={`var(--color-${key})`}
												key={key}
												radius={
													index === arr.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]
												}
												stackId="total"
											/>
										))}
									</BarChart>
								</ChartContainer>
							)}
						</CardContent>
					</Card>

					<Card className="flex flex-col justify-between">
						<CardHeader>
							<CardTitle className="font-semibold text-lg">
								Spending Insights
							</CardTitle>
							<CardDescription>
								Key insights from your spending patterns
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3 text-sm">
							{!hasAnyData ? (
								<p className="text-muted-foreground">
									Add expenses to unlock insights.
								</p>
							) : (
								<>
									<div className="rounded-md border bg-muted/40 p-3">
										<p className="text-muted-foreground">Average burn</p>
										<p className="font-semibold text-xl">
											{usdFormatter.format(averageBurn || 0)}
											<span className="font-normal text-muted-foreground text-xs">
												{" "}
												per month
											</span>
										</p>
									</div>
									{primaryLocalCurrency && (
										<div className="rounded-md border bg-muted/40 p-3">
											<p className="text-muted-foreground">
												Local currency trend
											</p>
											<p className="font-medium text-base">
												Spending in {primaryLocalCurrency}{" "}
												{localChange !== null
													? `is ${
															localChange > 0 ? "up" : "down"
														} ${percentFormatter.format(Math.abs(localChange))}`
													: "has not changed meaningfully"}{" "}
												this month.
											</p>
										</div>
									)}
									<p className="text-muted-foreground text-xs">
										Based on finalized expenses in the selected range.
									</p>
								</>
							)}
						</CardContent>
					</Card>
				</section>
			</PageContent>
		</>
	);
}

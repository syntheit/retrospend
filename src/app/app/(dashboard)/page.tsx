"use client";

import {
	eachDayOfInterval,
	endOfMonth,
	format,
	formatDistanceToNow,
	startOfMonth,
	subMonths,
} from "date-fns";
import {
	ArrowDownRight,
	ArrowUpRight,
	CalendarClock,
	LineChart,
	Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	Sector,
	XAxis,
} from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { toast } from "sonner";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { useIsMobile } from "~/hooks/use-mobile";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import {
	cn,
	formatCurrencyAmount,
	getCurrencySymbol,
	type NormalizedExpense,
	normalizeExpenses,
} from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type FavoriteRate = RouterOutputs["user"]["getFavoriteExchangeRates"][number];

type NormalizedFavorite = {
	id: string;
	currency: string;
	type: string;
	rate: number;
	date: Date;
};

const chartPalette = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

const colorClassCache = new Map<string, string>();

const resolveCategoryColorValue = (color?: string) => {
	if (!color) return null;
	const colorClasses =
		CATEGORY_COLOR_MAP[color as keyof typeof CATEGORY_COLOR_MAP];
	const bgClass = colorClasses?.split(" ").find((cls) => cls.startsWith("bg-"));
	if (!bgClass) return null;

	if (colorClassCache.has(bgClass)) {
		return colorClassCache.get(bgClass) ?? null;
	}

	if (typeof window === "undefined" || typeof document === "undefined") {
		return null;
	}

	try {
		const el = document.createElement("div");
		el.className = bgClass;
		el.style.position = "absolute";
		el.style.left = "-9999px";
		el.style.width = "1px";
		el.style.height = "1px";
		document.body.appendChild(el);
		const computed = getComputedStyle(el).backgroundColor;
		document.body.removeChild(el);

		if (computed) {
			colorClassCache.set(bgClass, computed);
			return computed;
		}
	} catch (error) {
		// DOM operation failed, return null gracefully
		return null;
	}

	return null;
};

export default function Page() {
	const {
		data: expensesData,
		isLoading: expensesLoading,
		isFetched: expensesFetched,
	} = api.expense.listFinalized.useQuery();
	const {
		data: favoritesData,
		isLoading: favoritesLoading,
		isFetched: favoritesFetched,
	} = api.user.getFavoriteExchangeRates.useQuery();
	const { data: settings } = api.user.getSettings.useQuery();
	const router = useRouter();
	const { openNewExpense } = useExpenseModal();
	const isMobile = useIsMobile();

	const homeCurrency = settings?.homeCurrency ?? "USD";
	const currencySymbol = getCurrencySymbol(homeCurrency);
	const categoryClickBehavior = settings?.categoryClickBehavior ?? "toggle";

	const expenses: NormalizedExpense[] = useMemo(
		() =>
			normalizeExpenses(
				(expensesData ?? []).map((expense) => ({
					...expense,
					amount: typeof expense.amount?.toNumber === "function" ? expense.amount.toNumber() : Number(expense.amount),
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

	const favoriteRates: NormalizedFavorite[] = useMemo(() => {
		if (!favoritesData) return [];
		return favoritesData.map((fav: FavoriteRate) => ({
			id: fav.id,
			currency: fav.rate.currency,
			type: fav.rate.type,
			rate: Number(fav.rate.rate),
			date: new Date(fav.rate.date),
		}));
	}, [favoritesData]);

	const now = new Date();
	const start = startOfMonth(now);
	const end = endOfMonth(now);
	const lastMonthStart = startOfMonth(subMonths(now, 1));
	const lastMonthEnd = endOfMonth(subMonths(now, 1));

	const {
		currentMonthExpenses,
		totalThisMonth,
		changeVsLastMonth,
		dailyAverage,
		projectedSpend,
	} = useMemo(() => {
		const monthlyTotals = new Map<string, number>();
		const currentMonth: NormalizedExpense[] = [];
		let currentTotal = 0;
		let previousMonthTotal = 0;

		for (const expense of expenses) {
			const date = new Date(expense.date);
			const amount = expense.amountInUSD ?? expense.amount;
			const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
			monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + amount);

			if (date >= start && date <= end) {
				currentMonth.push(expense);
				currentTotal += amount;
			} else if (date >= lastMonthStart && date <= lastMonthEnd) {
				previousMonthTotal += amount;
			}
		}

		const change =
			previousMonthTotal > 0
				? ((currentTotal - previousMonthTotal) / previousMonthTotal) * 100
				: null;

		const lastThreeMonthTotals: number[] = [];
		for (let i = 1; i <= 3; i++) {
			const target = subMonths(now, i);
			const key = `${target.getFullYear()}-${target.getMonth()}`;
			const monthTotal = monthlyTotals.get(key);
			if (monthTotal !== undefined) {
				lastThreeMonthTotals.push(monthTotal);
			}
		}

		const projected =
			lastThreeMonthTotals.length > 0
				? lastThreeMonthTotals.reduce((sum, value) => sum + value, 0) /
					lastThreeMonthTotals.length
				: currentTotal;

		const averagePerDay = currentTotal / Math.max(1, now.getDate());

		return {
			currentMonthExpenses: currentMonth,
			totalThisMonth: currentTotal,
			changeVsLastMonth: change,
			dailyAverage: averagePerDay,
			projectedSpend: projected,
		};
	}, [end, expenses, lastMonthEnd, lastMonthStart, now, start]);

	const dailyTrend = useMemo(() => {
		const byDay = new Map<string, number>();
		for (const expense of currentMonthExpenses) {
			const dayKey = format(expense.date, "yyyy-MM-dd");
			const amount = expense.amountInUSD ?? expense.amount;
			byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + amount);
		}

		let cumulativeTotal = 0;
		return eachDayOfInterval({ start, end: now }).map((day) => {
			const key = format(day, "yyyy-MM-dd");
			const dailyAmount = byDay.get(key) ?? 0;
			cumulativeTotal += dailyAmount;
			return {
				day: format(day, "MMM d"),
				dateLabel: format(day, "PP"),
				value: cumulativeTotal,
			};
		});
	}, [currentMonthExpenses, now, start]);

	const areaChartConfig: ChartConfig = {
		spend: {
			label: "Cumulative spend",
			color: "var(--chart-1)",
		},
	};

	const categoryBreakdown = useMemo(() => {
		const map = new Map<
			string,
			{ total: number; color?: string; id?: string }
		>();

		for (const expense of currentMonthExpenses) {
			const key = expense.category?.name ?? "Uncategorized";
			const amount = expense.amountInUSD ?? expense.amount;
			const existing = map.get(key);
			map.set(key, {
				total: (existing?.total ?? 0) + amount,
				color: expense.category?.color ?? existing?.color,
				id: expense.category?.id ?? existing?.id,
			});
		}

		return Array.from(map.entries()).map(([name, value], index) => {
			const resolvedColor =
				resolveCategoryColorValue(value.color) ??
				chartPalette[index % chartPalette.length];
			const key = (value.id ?? name)
				.toString()
				.replace(/\s+/g, "-")
				.toLowerCase();
			return {
				key,
				name,
				value: value.total,
				color: resolvedColor,
				categoryColor: value.color,
				categoryId: value.id,
			};
		});
	}, [currentMonthExpenses]);

	const [activeSliceIndex, setActiveSliceIndex] = useState<number | null>(null);
	const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
		new Set(),
	);
	const [pieRadii, setPieRadii] = useState<{ inner: number; outer: number }>({
		inner: 100,
		outer: 175,
	});
	const pieWrapperRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const target = pieWrapperRef.current;
		if (
			!target ||
			typeof window === "undefined" ||
			!("ResizeObserver" in window)
		) {
			return;
		}

		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.contentRect.width ?? 0;
			if (!width) return;

			const outer = Math.min(175, Math.max(110, width / 2 - 12));
			const inner = Math.max(72, Math.min(outer * 0.64, outer - 32));
			setPieRadii({ inner, outer });
		});

		observer.observe(target);
		return () => observer.disconnect();
	}, []);

	const visibleCategoryBreakdown = useMemo(() => {
		return categoryBreakdown.filter(
			(segment) =>
				!segment.categoryId || !hiddenCategories.has(segment.categoryId),
		);
	}, [categoryBreakdown, hiddenCategories]);

	const isSingleSlice = visibleCategoryBreakdown.length <= 1;
	const piePaddingAngle = isSingleSlice ? 0 : 1;
	const pieStroke = isSingleSlice ? "none" : "var(--card)";
	const pieStrokeWidth = isSingleSlice ? 0 : 3;

	const visibleTotal = useMemo(() => {
		return visibleCategoryBreakdown.reduce(
			(sum, segment) => sum + segment.value,
			0,
		);
	}, [visibleCategoryBreakdown]);

	const activeSlice =
		activeSliceIndex !== null
			? visibleCategoryBreakdown[activeSliceIndex]
			: null;

	const toggleCategoryVisibility = (categoryId: string) => {
		setHiddenCategories((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(categoryId)) {
				newSet.delete(categoryId);
			} else {
				newSet.add(categoryId);
			}
			return newSet;
		});
	};

	const handleCategoryClick = (segment: (typeof categoryBreakdown)[number]) => {
		// On mobile, do nothing - just allow highlighting like hover on desktop
		if (isMobile) {
			return;
		} else if (categoryClickBehavior === "toggle" && segment.categoryId) {
			toggleCategoryVisibility(segment.categoryId);
		} else {
			router.push("/app/table");
		}
	};

	const pieChartConfig: ChartConfig = useMemo(() => {
		return visibleCategoryBreakdown.reduce<ChartConfig>((config, segment) => {
			config[segment.key] = {
				label: segment.name,
				color: segment.color,
			};
			return config;
		}, {});
	}, [visibleCategoryBreakdown]);

	const handleSliceEnter = (_: unknown, index: number) => {
		setActiveSliceIndex(index);
	};

	const handleSliceLeave = () => {
		setActiveSliceIndex(null);
	};

	const recentExpenses = useMemo(() => {
		const sorted = [...expenses].sort(
			(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
		);
		return sorted.slice(0, 50);
	}, [expenses]);

	// create-expense handler removed: overview no longer offers a quick-create action

	const renderChangeBadge = (change: number | null) => {
		if (change === null) {
			return <Badge variant="secondary">No prior month</Badge>;
		}

		const positive = change >= 0;
		return (
			<Badge
				className="flex items-center gap-1"
				variant={positive ? "secondary" : "outline"}
			>
				{positive ? (
					<ArrowUpRight className="h-3.5 w-3.5" />
				) : (
					<ArrowDownRight className="h-3.5 w-3.5" />
				)}
				{`${positive ? "+" : ""}${change.toFixed(1)}% vs last month`}
			</Badge>
		);
	};

	const formatMoney = (value: number) =>
		`${currencySymbol}${formatCurrencyAmount(value)}`;

	const isUsingMockExpenses =
		!expensesFetched || (expensesData?.length ?? 0) === 0;
	const isUsingMockFavorites =
		!favoritesFetched || (favoritesData?.length ?? 0) === 0;

	const handleCreateExpense = () => {
		toast.dismiss();
		toast.info("Starting a new expense draft");
		openNewExpense();
	};

	const renderOnboarding = () => (
		<Card className="border-dashed">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					Welcome to Retrospend
				</CardTitle>
				<CardDescription>
					Add your first expense to replace the sample data and unlock real
					insights.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-2">
				<Button onClick={handleCreateExpense}>Add expense</Button>
				<Button asChild variant="outline">
					<Link href="/app/table">Go to table view</Link>
				</Button>
				<span className="text-muted-foreground text-xs">
					Charts will switch from sample data as soon as you add an expense.
				</span>
			</CardContent>
		</Card>
	);

	return (
		<>
			<SiteHeader title="Overview" />
			<PageContent>
				<div className="space-y-4 lg:space-y-6">
					{isUsingMockExpenses && renderOnboarding()}
					<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						<MetricCard
							description="Total spend this month"
							icon={<Wallet className="h-5 w-5 text-primary" />}
							isLoading={expensesLoading}
							value={formatMoney(totalThisMonth)}
						>
							{renderChangeBadge(changeVsLastMonth)}
						</MetricCard>
						<MetricCard
							description="Daily average (month-to-date)"
							icon={<CalendarClock className="h-5 w-5 text-primary" />}
							isLoading={expensesLoading}
							value={formatMoney(dailyAverage)}
						/>
						<MetricCard
							description="Projected spend (last 3 months avg.)"
							icon={<LineChart className="h-5 w-5 text-primary" />}
							isLoading={expensesLoading}
							value={formatMoney(projectedSpend)}
						/>
					</section>

					<section className="grid gap-4 lg:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle className="font-semibold text-lg">
									Category Distribution
								</CardTitle>
								<CardDescription>
									Where your money went this month
								</CardDescription>
							</CardHeader>
							<CardContent>
								{expensesLoading ? (
									<Skeleton className="h-[280px] w-full rounded-xl" />
								) : categoryBreakdown.length === 0 ? (
									<div className="rounded-lg border bg-muted/40 p-4 text-sm">
										No expenses logged this month.
									</div>
								) : (
									<div
										className="relative mx-auto w-full max-w-xl"
										ref={pieWrapperRef}
									>
										<ChartContainer
											className="aspect-square w-full sm:aspect-[4/3]"
											config={pieChartConfig}
										>
											<PieChart>
												<Pie
													activeIndex={activeSliceIndex ?? undefined}
													activeShape={(props: PieSectorDataItem) => {
														const {
															cx,
															cy,
															innerRadius = 0,
															outerRadius = 0,
															startAngle,
															endAngle,
															fill,
														} = props;
														return (
															<Sector
																className="cursor-pointer"
																cx={cx}
																cy={cy}
																endAngle={endAngle}
																fill={fill}
																innerRadius={innerRadius}
																outerRadius={outerRadius + 8}
																startAngle={startAngle}
																stroke={pieStroke}
																strokeWidth={pieStrokeWidth}
															/>
														);
													}}
													data={visibleCategoryBreakdown}
													dataKey="value"
													innerRadius={pieRadii.inner}
													nameKey="name"
													onClick={(_, index) => {
														const segment = visibleCategoryBreakdown[index];
														if (segment) {
															handleCategoryClick(segment);
														}
													}}
													onMouseEnter={handleSliceEnter}
													onMouseLeave={handleSliceLeave}
													outerRadius={pieRadii.outer}
													paddingAngle={piePaddingAngle}
													stroke={pieStroke}
													strokeWidth={pieStrokeWidth}
												>
													{visibleCategoryBreakdown.map((segment, index) => (
														<Cell
															className="cursor-pointer transition-opacity"
															fill={`var(--color-${segment.key})`}
															key={segment.key}
															opacity={
																activeSliceIndex === null ||
																activeSliceIndex === index
																	? 1
																	: 0.4
															}
															stroke={pieStroke}
															strokeWidth={pieStrokeWidth}
														/>
													))}
												</Pie>
												<text
													className="pointer-events-none fill-foreground"
													dominantBaseline="middle"
													style={{ fontSize: "14px", fontWeight: "500" }}
													textAnchor="middle"
													x="50%"
													y="48%"
												>
													<tspan
														className="fill-muted-foreground"
														dy="-0.5em"
														style={{ fontSize: "12px" }}
														x="50%"
													>
														{activeSlice ? activeSlice.name : "Total"}
													</tspan>
													<tspan
														dy="1.2em"
														style={{ fontSize: "24px", fontWeight: "600" }}
														x="50%"
													>
														{activeSlice
															? formatMoney(activeSlice.value)
															: formatMoney(visibleTotal)}
													</tspan>
												</text>
											</PieChart>
										</ChartContainer>
										<div className="mt-4 grid gap-2 sm:grid-cols-2">
											{categoryBreakdown.map((segment) => {
												const dotClass = segment.categoryColor
													? CATEGORY_COLOR_MAP[
															segment.categoryColor as keyof typeof CATEGORY_COLOR_MAP
														]?.split(" ")[0]
													: "bg-muted-foreground";
												const isHidden =
													segment.categoryId &&
													hiddenCategories.has(segment.categoryId);
												return (
													<button
														key={segment.key}
														className={cn(
															"group flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left transition-all",
															isHidden
																? "bg-muted/20 opacity-60 hover:bg-muted/30"
																: "bg-muted/30 hover:bg-muted/50",
														)}
														{...(categoryClickBehavior === "toggle" &&
														!!segment.categoryId
															? {
																	"aria-pressed": Boolean(isHidden),
																}
															: {})}
														onClick={() => handleCategoryClick(segment)}
														onKeyDown={(e) => {
															if (e.key === "Enter" || e.key === " ") {
																e.preventDefault();
																handleCategoryClick(segment);
															}
														}}
														type="button"
													>
														<div className="flex items-center gap-2">
															<span
																className={cn(
																	"h-3 w-3 rounded-full",
																	dotClass,
																	isHidden && "opacity-50",
																)}
															/>
															<span
																className={cn(
																	"text-sm transition-all",
																	isHidden
																		? "line-through opacity-70"
																		: "group-hover:underline",
																)}
															>
																{segment.name}
															</span>
														</div>
														<span
															className={cn(
																"font-semibold text-sm",
																isHidden && "opacity-70",
															)}
														>
															{formatMoney(segment.value)}
														</span>
													</button>
												);
											})}
										</div>
										{isUsingMockExpenses && (
											<p className="mt-3 text-muted-foreground text-xs">
												Using sample data until expenses are added.
											</p>
										)}
									</div>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-start justify-between">
								<div>
									<CardTitle className="font-semibold text-lg">
										Recent Activity
									</CardTitle>
									<CardDescription>Latest finalized expenses</CardDescription>
								</div>
								<Button asChild size="sm" variant="ghost">
									<Link href="/app/table">View all</Link>
								</Button>
							</CardHeader>
							<CardContent className="px-4 sm:px-6">
								{expensesLoading ? (
									<div className="space-y-2">
										<Skeleton className="h-12 w-full" />
										<Skeleton className="h-12 w-full" />
										<Skeleton className="h-12 w-full" />
									</div>
								) : recentExpenses.length === 0 ? (
									<div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
										<div>
											<div className="font-medium">No expenses yet</div>
											<p className="text-muted-foreground text-sm">
												Create your first expense to see it here.
											</p>
										</div>
									</div>
								) : (
									<div className="max-h-[768px] overflow-y-auto rounded-lg border bg-background/40 p-2 sm:border-0 sm:bg-transparent sm:p-0">
										<Table className="w-full table-fixed">
											<TableHeader>
												<TableRow>
													<TableHead className="w-1/2">Expense</TableHead>
													<TableHead className="w-1/4">Date</TableHead>
													<TableHead className="w-1/4 text-right">
														Amount
													</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{recentExpenses.map((expense) => {
													const amount = expense.amountInUSD ?? expense.amount;
													const showOriginal =
														expense.currency !== homeCurrency &&
														(expense.amountInUSD ?? null) !== null;
													const originalSymbol = getCurrencySymbol(
														expense.currency,
													);
													const categoryName =
														expense.category?.name ?? "Uncategorized";
													const colorKey = expense.category
														?.color as keyof typeof CATEGORY_COLOR_MAP;
													const categoryColor =
														CATEGORY_COLOR_MAP[colorKey] ??
														"bg-muted text-foreground";

													return (
														<TableRow key={expense.id}>
															<TableCell>
																<div className="flex min-w-0 items-center gap-3">
																	<div
																		className={cn(
																			"flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full font-semibold text-xs",
																			categoryColor,
																		)}
																	>
																		{categoryName.substring(0, 2).toUpperCase()}
																	</div>
																	<div className="min-w-0 space-y-0.5">
																		<div className="font-medium truncate">
																			{expense.title || "Untitled expense"}
																		</div>
																		<div className="text-muted-foreground text-xs truncate">
																			{categoryName}
																		</div>
																	</div>
																</div>
															</TableCell>
															<TableCell className="whitespace-nowrap text-muted-foreground text-sm">
																{format(expense.date, "MMM d")}
															</TableCell>
															<TableCell className="whitespace-nowrap text-right">
																<div className="font-semibold">
																	{formatMoney(amount)}
																</div>
																{showOriginal && (
																	<div className="text-muted-foreground text-xs">
																		{`${originalSymbol}${formatCurrencyAmount(expense.amount)}`}
																	</div>
																)}
															</TableCell>
														</TableRow>
													);
												})}
											</TableBody>
										</Table>
									</div>
								)}
							</CardContent>
						</Card>
					</section>

					<section className="grid gap-4 lg:grid-cols-3">
						<Card className="lg:col-span-2">
							<CardHeader>
								<CardTitle className="font-semibold text-lg">
									Cumulative Spending
								</CardTitle>
								<CardDescription>
									Cumulative spending for {format(now, "MMMM")}
								</CardDescription>
							</CardHeader>
							<CardContent className="px-2 pb-6 sm:px-6">
								{expensesLoading ? (
									<Skeleton className="h-[280px] w-full rounded-xl" />
								) : (
									<ChartContainer
										className="aspect-[16/6] h-full"
										config={areaChartConfig}
									>
										<AreaChart data={dailyTrend}>
											<defs>
												<linearGradient
													id="fillSpend"
													x1="0"
													x2="0"
													y1="0"
													y2="1"
												>
													<stop
														offset="5%"
														stopColor="var(--color-spend)"
														stopOpacity={0.9}
													/>
													<stop
														offset="95%"
														stopColor="var(--color-spend)"
														stopOpacity={0.1}
													/>
												</linearGradient>
											</defs>
											<CartesianGrid vertical={false} />
											<XAxis
												axisLine={false}
												dataKey="day"
												minTickGap={24}
												tickLine={false}
												tickMargin={8}
											/>
											<ChartTooltip
												content={
													<ChartTooltipContent
														labelFormatter={(value) => value}
														nameKey="spend"
													/>
												}
											/>
											<Area
												dataKey="value"
												fill="url(#fillSpend)"
												stroke="var(--color-spend)"
												strokeWidth={2.5}
												type="monotone"
											/>
										</AreaChart>
									</ChartContainer>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className="font-semibold text-lg">
									Exchange Rates
								</CardTitle>
								<CardDescription>Favorite exchange rates</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 space-y-3 overflow-y-auto">
								{favoritesLoading ? (
									<div className="space-y-2">
										<Skeleton className="h-12 w-full" />
										<Skeleton className="h-12 w-full" />
										<Skeleton className="h-12 w-full" />
									</div>
								) : favoriteRates.length === 0 ? (
									<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
										<div className="font-medium">
											Star currencies in Settings to track them here.
										</div>
										<Button asChild size="sm" variant="outline">
											<Link href="/app/settings">Open settings</Link>
										</Button>
									</div>
								) : (
									<div className="space-y-2">
										{favoriteRates.map((rate) => (
											<div
												className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2"
												key={rate.id}
											>
												<div>
													<div className="flex items-center gap-2">
														<span className="font-mono font-semibold">
															{rate.currency}
														</span>
														<Badge className="capitalize" variant="secondary">
															{rate.type}
														</Badge>
													</div>
													<p className="text-muted-foreground text-xs">
														Updated{" "}
														{formatDistanceToNow(rate.date, {
															addSuffix: true,
														})}
													</p>
												</div>
												<div className="text-right font-semibold">
													{rate.rate.toLocaleString(undefined, {
														maximumFractionDigits: 4,
													})}
												</div>
											</div>
										))}
										{isUsingMockFavorites && (
											<p className="text-muted-foreground text-xs">
												Using sample data until favorites are added.
											</p>
										)}
									</div>
								)}
							</CardContent>
						</Card>
					</section>
				</div>
			</PageContent>
		</>
	);
}

function MetricCard({
	description,
	icon,
	value,
	children,
	isLoading,
}: {
	description: string;
	icon: React.ReactNode;
	value: string;
	children?: React.ReactNode;
	isLoading?: boolean;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div className="space-y-1">
					<CardDescription>{description}</CardDescription>
					{isLoading ? (
						<Skeleton className="h-7 w-28" />
					) : (
						<CardTitle className="font-bold text-2xl">{value}</CardTitle>
					)}
					{!isLoading && children}
				</div>
				<div className="rounded-full bg-muted p-2 text-primary">{icon}</div>
			</CardHeader>
		</Card>
	);
}

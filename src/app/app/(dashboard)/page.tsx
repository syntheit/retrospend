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
	Briefcase,
	Clock,
	TrendingDown,
	TrendingUp,
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
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import {
	cn,
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
	normalizeExpensesFromApi,
} from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { CategoryDonut } from "./_components/category-donut";
import { FavoritesPanel } from "./_components/favorites-panel";
import { RecentExpenses } from "./_components/recent-expenses";
import { StatsCards } from "./_components/stats-cards";
import { TrendChart } from "./_components/trend-chart";

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
	} catch {
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
	const { data: overviewStats } = api.dashboard.getOverviewStats.useQuery();
	const router = useRouter();
	const { openNewExpense } = useExpenseModal();

	const homeCurrency = settings?.homeCurrency ?? "USD";
	const { formatCurrency } = useCurrencyFormatter();
	const { data: baseCurrencyRate } =
		api.exchangeRate.getRatesForCurrency.useQuery(
			{ currency: homeCurrency },
			{ enabled: homeCurrency !== "USD" },
		);
	const categoryClickBehavior = settings?.categoryClickBehavior ?? "toggle";

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

	const expenses: NormalizedExpense[] = useMemo(
		() => normalizeExpensesFromApi(expensesData ?? []),
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
			const amount = convertExpenseAmountForDisplay(
				expense,
				homeCurrency,
				liveRateToBaseCurrency,
			);
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
	}, [
		end,
		expenses,
		lastMonthEnd,
		lastMonthStart,
		now,
		start,
		homeCurrency,
		liveRateToBaseCurrency,
	]);

	const dailyTrend = useMemo(() => {
		const byDay = new Map<string, number>();
		for (const expense of currentMonthExpenses) {
			const dayKey = format(expense.date, "yyyy-MM-dd");
			const amount = convertExpenseAmountForDisplay(
				expense,
				homeCurrency,
				liveRateToBaseCurrency,
			);
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
	}, [currentMonthExpenses, now, start, homeCurrency, liveRateToBaseCurrency]);

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
			const amount = convertExpenseAmountForDisplay(
				expense,
				homeCurrency,
				liveRateToBaseCurrency,
			);
			const existing = map.get(key);
			map.set(key, {
				total: (existing?.total ?? 0) + amount,
				color: expense.category?.color ?? existing?.color,
				id: expense.category?.id ?? existing?.id,
			});
		}

		return Array.from(map.entries())
			.map(([name, value], index) => {
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
			})
			.sort((a, b) => b.value - a.value);
	}, [currentMonthExpenses, homeCurrency, liveRateToBaseCurrency]);

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
		if (categoryClickBehavior === "toggle" && segment.categoryId) {
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

	const formatMoney = (value: number) => formatCurrency(value, homeCurrency);

	const isUsingMockExpenses =
		!expensesFetched || (expensesData?.length ?? 0) === 0;
	const isUsingMockFavorites =
		!favoritesFetched || (favoritesData?.length ?? 0) === 0;

	const handleCreateExpense = () => {
		toast.dismiss();
		toast.info("Starting a new expense");
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
					<StatsCards
						expensesLoading={expensesLoading}
						overviewStats={overviewStats}
						totalThisMonth={totalThisMonth}
						changeVsLastMonth={changeVsLastMonth}
						dailyAverage={dailyAverage}
						projectedSpend={projectedSpend}
						categoryBreakdown={categoryBreakdown}
						homeCurrency={homeCurrency}
					/>

					<section className="grid gap-4 lg:grid-cols-2">
						<CategoryDonut
							expensesLoading={expensesLoading}
							categoryBreakdown={categoryBreakdown}
							visibleCategoryBreakdown={visibleCategoryBreakdown}
							activeSliceIndex={activeSliceIndex}
							activeSlice={activeSlice}
							visibleTotal={visibleTotal}
							pieChartConfig={pieChartConfig}
							hiddenCategories={hiddenCategories}
							categoryClickBehavior={categoryClickBehavior}
							formatMoney={formatMoney}
							isUsingMockExpenses={isUsingMockExpenses}
							resolveCategoryColorValue={resolveCategoryColorValue}
							handleCategoryClick={handleCategoryClick}
							handleSliceEnter={handleSliceEnter}
							handleSliceLeave={handleSliceLeave}
						/>

						<RecentExpenses
							expensesLoading={expensesLoading}
							recentExpenses={recentExpenses}
							homeCurrency={homeCurrency}
							liveRateToBaseCurrency={liveRateToBaseCurrency}
							formatCurrency={formatCurrency}
						/>
					</section>

					<section className="grid gap-4 lg:grid-cols-3">
						<TrendChart
							expensesLoading={expensesLoading}
							dailyTrend={dailyTrend}
							areaChartConfig={areaChartConfig}
							now={now}
						/>

						<FavoritesPanel
							favoritesLoading={favoritesLoading}
							favoriteRates={favoriteRates}
							isUsingMockFavorites={isUsingMockFavorites}
						/>
					</section>
				</div>
			</PageContent>
		</>
	);
}

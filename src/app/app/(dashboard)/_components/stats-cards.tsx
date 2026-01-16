"use client";

import {
	Briefcase,
	Calendar,
	Clock,
	TrendingDown,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";

interface StatsCardsProps {
	expensesLoading: boolean;
	overviewStats?: {
		last24Hours: number;
		isCurrentMonth: boolean;
		monthTotal: number;
		workEquivalent: {
			totalSpent: number;
			monthlyIncome?: number;
		};
		dailyBudgetPace: {
			totalSpent: number;
			totalBudget?: number;
		};
	};
	totalThisMonth: number;
	changeVsLastMonth: number | null;
	dailyAverage: number;
	projectedSpend: number;
	categoryBreakdown: Array<{
		name: string;
		value: number;
	}>;
	homeCurrency: string;
}

export function StatsCards({
	expensesLoading,
	overviewStats,
	totalThisMonth,
	changeVsLastMonth,
	dailyAverage,
	projectedSpend,
	categoryBreakdown,
	homeCurrency,
}: StatsCardsProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const formatMoney = (value: number) => formatCurrency(value, homeCurrency);
	const isPositiveChange = changeVsLastMonth !== null && changeVsLastMonth >= 0;

	// Calculate budget usage percentage
	const budgetUsagePct =
		overviewStats?.dailyBudgetPace.totalBudget &&
		overviewStats.dailyBudgetPace.totalBudget > 0
			? (overviewStats.dailyBudgetPace.totalSpent /
					overviewStats.dailyBudgetPace.totalBudget) *
				100
			: 0;

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{/* Hero Card - Total Monthly Spending */}
			<StatCard
				description={
					!expensesLoading && dailyAverage > 0 ? (
						<>
							Avg:{" "}
							<span className="font-medium text-white">
								{formatMoney(dailyAverage)}/day
							</span>
						</>
					) : null
				}
				icon={Wallet}
				loading={expensesLoading}
				theme="neutral"
				title="Total This Month"
				trend={
					expensesLoading
						? undefined
						: {
								value: changeVsLastMonth,
								label: "vs last month",
								intent: isPositiveChange ? "negative" : "positive",
							}
				}
				value={expensesLoading ? undefined : formatMoney(totalThisMonth)}
			/>

			{/* Last 24 Hours / Month Total */}
			{overviewStats?.isCurrentMonth !== false ? (
				<StatCard
					formatCurrency={formatCurrency}
					icon={Clock}
					loading={expensesLoading}
					theme="blue"
					title="Last 24 Hours"
					trend={
						!expensesLoading &&
						overviewStats &&
						dailyAverage > 0 &&
						overviewStats.last24Hours !== dailyAverage
							? {
									value: overviewStats.last24Hours - dailyAverage,
									label: "vs daily avg",
									isMoney: true,
									intent:
										overviewStats.last24Hours > dailyAverage
											? "negative"
											: "positive",
									forceNeutral: true,
								}
							: undefined
					}
					value={
						expensesLoading
							? undefined
							: formatMoney(overviewStats?.last24Hours ?? 0)
					}
				/>
			) : (
				<StatCard
					description="Final spend for this month"
					icon={Calendar}
					loading={expensesLoading}
					theme="cyan"
					title="Month Total"
					value={
						expensesLoading
							? undefined
							: formatMoney(overviewStats?.monthTotal ?? 0)
					}
				/>
			)}

			{/* Work Equivalent / Top Category */}
			{overviewStats?.workEquivalent.monthlyIncome &&
			overviewStats.workEquivalent.monthlyIncome > 0 ? (
				<StatCard
					description="Time cost of this month"
					icon={Briefcase}
					loading={expensesLoading}
					theme="violet"
					title="Work Equivalent"
					value={
						expensesLoading
							? undefined
							: `${Math.round(
									(overviewStats.workEquivalent.totalSpent /
										overviewStats.workEquivalent.monthlyIncome) *
										160,
								)}h`
					}
				/>
			) : (
				<StatCard
					description={
						!expensesLoading &&
						categoryBreakdown.length > 0 &&
						formatMoney(categoryBreakdown[0]?.value ?? 0)
					}
					icon={Briefcase}
					loading={expensesLoading}
					theme="violet"
					title="Top Category"
					value={
						expensesLoading
							? undefined
							: categoryBreakdown.length > 0
								? categoryBreakdown[0]?.name
								: "No expenses"
					}
				/>
			)}

			{/* Budget Used / Projected */}
			{overviewStats?.dailyBudgetPace.totalBudget &&
			overviewStats.dailyBudgetPace.totalBudget > 0 ? (
				<StatCard
					description={
						!expensesLoading && (
							<>
								{formatMoney(overviewStats.dailyBudgetPace.totalSpent)} of{" "}
								{formatMoney(overviewStats.dailyBudgetPace.totalBudget)}
							</>
						)
					}
					icon={Wallet}
					loading={expensesLoading}
					theme={budgetUsagePct > 80 ? "amber" : "blue"}
					title="Budget Used"
					value={expensesLoading ? undefined : `${Math.round(budgetUsagePct)}%`}
				/>
			) : (
				<StatCard
					description="Last 3 months average"
					icon={Wallet}
					loading={expensesLoading}
					theme="blue"
					title="Projected Total"
					value={expensesLoading ? undefined : formatMoney(projectedSpend)}
				/>
			)}
		</div>
	);
}

// ----------------------------------------------------------------------
// Reusable StatCard Component
// ----------------------------------------------------------------------

interface StatCardProps {
	description?: React.ReactNode;
	formatCurrency?: (value: number, currency?: string) => string;
	icon: React.ElementType;
	loading: boolean;
	theme: "neutral" | "blue" | "cyan" | "violet" | "amber";
	title: string;
	trend?: {
		value: number | null;
		label: string;
		isMoney?: boolean;
		intent?: "positive" | "negative";
		forceNeutral?: boolean;
	};
	value?: React.ReactNode;
}

function StatCard({
	description,
	formatCurrency,
	icon: Icon,
	loading,
	theme,
	title,
	trend,
	value,
}: StatCardProps) {
	// Theme configurations
	const themes = {
		amber: {
			cardInfo:
				"border-amber-200/50 bg-gradient-to-br from-amber-50 to-white hover:shadow-lg hover:shadow-amber-100 dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card",
			circle: "bg-amber-500/10",
			textSub: "text-amber-700 dark:text-amber-400",
			textMain: "text-amber-900 dark:text-amber-100",
			iconBg: "bg-amber-100 dark:bg-amber-900/50",
			iconColor: "text-amber-600 dark:text-amber-400",
			desc: "text-amber-600/80 dark:text-amber-400/80",
		},
		blue: {
			cardInfo:
				"border-blue-200/50 bg-gradient-to-br from-blue-50 to-white hover:shadow-lg hover:shadow-blue-100 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-card",
			circle: "bg-blue-500/10",
			textSub: "text-blue-700 dark:text-blue-400",
			textMain: "text-blue-900 dark:text-blue-100",
			iconBg: "bg-blue-100 dark:bg-blue-900/50",
			iconColor: "text-blue-600 dark:text-blue-400",
			desc: "text-blue-600/80 dark:text-blue-400/80",
		},
		cyan: {
			cardInfo:
				"border-cyan-200/50 bg-gradient-to-br from-cyan-50 to-white hover:shadow-lg hover:shadow-cyan-100 dark:border-cyan-900/50 dark:from-cyan-950/30 dark:to-card",
			circle: "bg-cyan-500/10",
			textSub: "text-cyan-700 dark:text-cyan-400",
			textMain: "text-cyan-900 dark:text-cyan-100",
			iconBg: "bg-cyan-100 dark:bg-cyan-900/50",
			iconColor: "text-cyan-600 dark:text-cyan-400",
			desc: "text-cyan-600/80 dark:text-cyan-400/80",
		},
		neutral: {
			cardInfo:
				"border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-lg hover:shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black",
			circle: "bg-white/10",
			textSub: "text-stone-300",
			textMain: "text-white",
			iconBg: "bg-white/10",
			iconColor: "text-stone-300",
			desc: "text-stone-400",
		},
		violet: {
			cardInfo:
				"border-violet-200/50 bg-gradient-to-br from-violet-50 to-white hover:shadow-lg hover:shadow-violet-100 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-card",
			circle: "bg-violet-500/10",
			textSub: "text-violet-700 dark:text-violet-400",
			textMain: "text-violet-900 dark:text-violet-100",
			iconBg: "bg-violet-100 dark:bg-violet-900/50",
			iconColor: "text-violet-600 dark:text-violet-400",
			desc: "text-violet-600/80 dark:text-violet-400/80",
		},
	};

	const s = themes[theme];

	return (
		<Card
			className={cn(
				"group relative overflow-hidden transition-all duration-300",
				s.cardInfo,
			)}
		>
			{/* Decorative Circle */}
			<div
				className={cn(
					"absolute top-0 right-0 h-20 w-20 translate-x-8 -translate-y-8 rounded-full transition-transform duration-300 group-hover:scale-150",
					s.circle,
				)}
			/>

			<CardContent className="relative p-4">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<p className={cn("font-medium text-sm", s.textSub)}>{title}</p>
						{loading ? (
							<Skeleton
								className={cn("h-8 w-28", theme === "neutral" && "bg-white/10")}
							/>
						) : (
							<p
								className={cn("font-bold text-2xl tracking-tight", s.textMain)}
							>
								{value}
							</p>
						)}
					</div>
					<div className={cn("rounded-lg p-2.5", s.iconBg)}>
						<Icon className={cn("h-5 w-5", s.iconColor)} />
					</div>
				</div>

				{/* Footer Content: Trend or Description */}
				{!loading && (
					<div className={cn("mt-2 flex flex-col gap-1", s.desc)}>
						{trend && trend.value !== null && trend.value !== undefined && (
							<div className="flex items-center gap-1.5 text-sm">
								<div
									className={cn(
										"flex items-center gap-1 font-medium",
										trend.forceNeutral
											? "text-inherit"
											: trend.intent === "negative"
												? "text-red-300"
												: "text-emerald-300",
									)}
								>
									{trend.value > 0 ? (
										<TrendingUp className="h-3.5 w-3.5" />
									) : (
										<TrendingDown className="h-3.5 w-3.5" />
									)}
									{trend.value > 0 ? "+" : ""}
									{trend.isMoney && formatCurrency
										? formatCurrency(trend.value)
										: `${trend.value.toFixed(1)}%`}
								</div>
								<span>{trend.label}</span>
							</div>
						)}
						{description && <div className="text-sm">{description}</div>}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

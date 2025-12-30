"use client";

import {
	ArrowDownRight,
	ArrowUpRight,
	Briefcase,
	Clock,
	TrendingDown,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

interface StatsCardsProps {
	expensesLoading: boolean;
	overviewStats?: {
		last24Hours: number;
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

	return (
		<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{/* Last 24 Hours Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="space-y-1">
						<CardDescription>Last 24 hours</CardDescription>
						{expensesLoading ? (
							<Skeleton className="h-7 w-28" />
						) : (
							<CardTitle className="font-bold text-2xl">
								{formatMoney(overviewStats?.last24Hours ?? 0)}
							</CardTitle>
						)}
						{!expensesLoading && overviewStats && (
							<div className="flex items-center gap-1 text-muted-foreground text-sm">
								{dailyAverage > 0 &&
								overviewStats.last24Hours !== dailyAverage ? (
									overviewStats.last24Hours > dailyAverage ? (
										<>
											<TrendingUp className="h-3 w-3 text-green-600" />
											<span className="text-green-600">
												+
												{formatCurrency(
													overviewStats.last24Hours - dailyAverage,
													homeCurrency,
												)}{" "}
												vs daily avg
											</span>
										</>
									) : (
										<>
											<TrendingDown className="h-3 w-3 text-red-600" />
											<span className="text-red-600">
												-
												{formatCurrency(
													dailyAverage - overviewStats.last24Hours,
													homeCurrency,
												)}{" "}
												vs daily avg
											</span>
										</>
									)
								) : (
									<span>On track</span>
								)}
							</div>
						)}
					</div>
					<div className="rounded-full bg-muted p-2 text-primary">
						<Clock className="h-5 w-5" />
					</div>
				</CardHeader>
			</Card>

			{/* Monthly Spend Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="space-y-1">
						<CardDescription>This month total</CardDescription>
						{expensesLoading ? (
							<Skeleton className="h-7 w-28" />
						) : (
							<CardTitle className="font-bold text-2xl">
								{formatMoney(totalThisMonth)}
							</CardTitle>
						)}
						{!expensesLoading && renderChangeBadge(changeVsLastMonth)}
					</div>
					<div className="rounded-full bg-muted p-2 text-primary">
						<Wallet className="h-5 w-5" />
					</div>
				</CardHeader>
			</Card>

			{/* Work Equivalent Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="space-y-1">
						{overviewStats?.workEquivalent.monthlyIncome &&
						overviewStats.workEquivalent.monthlyIncome > 0 ? (
							<>
								<CardDescription>Work equivalent</CardDescription>
								{expensesLoading ? (
									<Skeleton className="h-7 w-28" />
								) : (
									<CardTitle className="font-bold text-2xl">
										{Math.round(
											(overviewStats.workEquivalent.totalSpent /
												overviewStats.workEquivalent.monthlyIncome) *
												160,
										)}
										h
									</CardTitle>
								)}
								{!expensesLoading && (
									<div className="text-muted-foreground text-sm">
										Time cost of this month
									</div>
								)}
							</>
						) : (
							<>
								<CardDescription>Top spending category</CardDescription>
								{expensesLoading ? (
									<Skeleton className="h-7 w-28" />
								) : (
									<CardTitle className="font-bold text-xl">
										{categoryBreakdown.length > 0
											? categoryBreakdown[0]?.name
											: "No expenses"}
									</CardTitle>
								)}
								{!expensesLoading && categoryBreakdown.length > 0 && (
									<div className="text-muted-foreground text-sm">
										{formatMoney(categoryBreakdown[0]?.value ?? 0)}
									</div>
								)}
							</>
						)}
					</div>
					<div className="rounded-full bg-muted p-2 text-primary">
						<Briefcase className="h-5 w-5" />
					</div>
				</CardHeader>
			</Card>

			{/* Budget Used Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="space-y-1">
						{overviewStats?.dailyBudgetPace.totalBudget &&
						overviewStats.dailyBudgetPace.totalBudget > 0 ? (
							<>
								<CardDescription>Budget used</CardDescription>
								{expensesLoading ? (
									<Skeleton className="h-7 w-28" />
								) : (
									<CardTitle className="font-bold text-2xl">
										{Math.round(
											(overviewStats.dailyBudgetPace.totalSpent /
												overviewStats.dailyBudgetPace.totalBudget) *
												100,
										)}
										%
									</CardTitle>
								)}
								{!expensesLoading && (
									<div className="text-muted-foreground text-sm">
										{formatMoney(
											overviewStats.dailyBudgetPace.totalSpent,
										)}{" "}
										of{" "}
										{formatMoney(
											overviewStats.dailyBudgetPace.totalBudget,
										)}
									</div>
								)}
							</>
						) : (
							<>
								<CardDescription>Projected month end</CardDescription>
								{expensesLoading ? (
									<Skeleton className="h-7 w-28" />
								) : (
									<CardTitle className="font-bold text-2xl">
										{formatMoney(projectedSpend)}
									</CardTitle>
								)}
								{!expensesLoading && (
									<div className="text-muted-foreground text-sm">
										Last 3 months average
									</div>
								)}
							</>
						)}
					</div>
					<div className="rounded-full bg-muted p-2 text-primary">
						<Wallet className="h-5 w-5" />
					</div>
				</CardHeader>
			</Card>
		</section>
	);
}

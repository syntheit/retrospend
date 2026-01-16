"use client";

import {
	CreditCard,
	Droplets,
	Percent,
	TrendingDown,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

interface NetWorthSummaryProps {
	totalNetWorth: number;
	totalAssets: number;
	totalLiabilities: number;
	totalLiquidAssets: number;
	weightedAPR: number;
	homeCurrency: string;
	monthlyChange?: number;
	monthlyChangePercent?: number;
}

export function NetWorthSummary({
	totalNetWorth,
	totalAssets,
	totalLiabilities,
	totalLiquidAssets,
	weightedAPR,
	homeCurrency,
	monthlyChange,
}: NetWorthSummaryProps) {
	const { formatCurrency } = useCurrencyFormatter();

	// Empty state for when there's no wealth data
	if (totalNetWorth === 0 && totalAssets === 0 && totalLiabilities === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<TrendingUp className="h-12 w-12 text-muted-foreground/50" />
					<h3 className="mt-4 font-medium text-lg">No wealth data yet</h3>
					<p className="mt-2 text-center text-muted-foreground text-sm">
						Add your first asset or liability to start tracking your net worth.
					</p>
				</CardContent>
			</Card>
		);
	}

	const isPositiveChange = (monthlyChange ?? 0) >= 0;
	const _TrendIcon = isPositiveChange ? TrendingUp : TrendingDown;

	return (
		<div className="grid gap-4 md:grid-cols-3">
			{/* Hero Net Worth Card */}
			<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black">
				<div className="absolute top-0 right-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full bg-white/5" />
				<CardContent className="relative p-5">
					<div className="space-y-4">
						<div className="space-y-1">
							<p className="font-medium text-sm text-stone-300">
								Total Net Worth
							</p>
							<p className="font-bold text-3xl tracking-tight">
								{formatCurrency(totalNetWorth, homeCurrency)}
							</p>
						</div>
						<div className="flex w-fit items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 backdrop-blur-sm">
							<Wallet className="h-4 w-4 text-stone-300" />
							<span className="font-medium text-stone-300 text-xs">
								Liquid: {formatCurrency(totalLiquidAssets, homeCurrency)}
							</span>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Assets Card - Green theme */}
			<Card className="group relative overflow-hidden border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white transition-all duration-300 hover:shadow-emerald-100 hover:shadow-lg dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-card">
				<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-500/10 transition-transform duration-300 group-hover:scale-150" />
				<CardContent className="relative p-5">
					<div className="flex items-start justify-between">
						<div className="space-y-1">
							<p className="font-medium text-emerald-700 text-sm dark:text-emerald-400">
								Total Assets
							</p>
							<p className="font-bold text-2xl text-emerald-900 dark:text-emerald-100">
								{formatCurrency(totalAssets, homeCurrency)}
							</p>
						</div>
						<div className="rounded-lg bg-emerald-100 p-2 dark:bg-emerald-900/50">
							<TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
						</div>
					</div>
					<div className="mt-3 flex items-center gap-1.5 text-emerald-600/80 text-xs dark:text-emerald-400/80">
						<Droplets className="h-3.5 w-3.5" />
						<span>
							Liquid: {formatCurrency(totalLiquidAssets, homeCurrency)}
						</span>
					</div>
				</CardContent>
			</Card>

			{/* Liabilities Card - Amber theme */}
			<Card className="group relative overflow-hidden border-amber-200/50 bg-gradient-to-br from-amber-50 to-white transition-all duration-300 hover:shadow-amber-100 hover:shadow-lg dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card">
				<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-amber-500/10 transition-transform duration-300 group-hover:scale-150" />
				<CardContent className="relative p-5">
					<div className="flex items-start justify-between">
						<div className="space-y-1">
							<p className="font-medium text-amber-700 text-sm dark:text-amber-400">
								Total Liabilities
							</p>
							<p className="font-bold text-2xl text-amber-900 dark:text-amber-100">
								{formatCurrency(totalLiabilities, homeCurrency)}
							</p>
						</div>
						<div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/50">
							<CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
						</div>
					</div>
					<div className="mt-3 flex items-center gap-1.5 text-amber-600/80 text-xs dark:text-amber-400/80">
						<Percent className="h-3.5 w-3.5" />
						<span>
							Weighted APR:{" "}
							{weightedAPR > 0 ? `${weightedAPR.toFixed(1)}%` : "N/A"}
						</span>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

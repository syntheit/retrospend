"use client";

import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

export default function MonthlySummaryWidget(_props: WidgetProps) {
	const t = useTranslations("stats");
	const { data, isLoading } = useDashboardContext();
	const { formatCurrency } = useCurrencyFormatter();
	const formatMoney = (value: number) =>
		formatCurrency(value, data.homeCurrency);

	if (isLoading.stats) {
		return (
			<div className="space-y-3 p-1">
				<Skeleton className="h-8 w-32" />
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-4 w-20" />
			</div>
		);
	}

	const total = data.summaryStats?.totalThisMonth ?? 0;
	const change = data.summaryStats?.changeVsLastMonth ?? null;
	const dailyAvg = data.summaryStats?.dailyAverage ?? 0;
	const isPositive = change !== null && change >= 0;

	return (
		<div className="flex flex-col gap-3 p-1">
			<div className="flex items-start justify-between">
				<div>
					<div className="font-bold text-2xl tabular-nums tracking-tight">
						{formatMoney(total)}
					</div>
					<p className="text-muted-foreground text-sm">
						{t("totalThisMonth")}
					</p>
				</div>
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
					<Wallet className="h-5 w-5 text-muted-foreground" />
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-3">
				{change !== null && (
					<div
						className={cn(
							"flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
							isPositive
								? "bg-rose-500/10 text-rose-500"
								: "bg-emerald-500/10 text-emerald-500",
						)}
					>
						{isPositive ? (
							<TrendingUp className="h-3 w-3" />
						) : (
							<TrendingDown className="h-3 w-3" />
						)}
						{Math.abs(change).toFixed(0)}% {t("vsLastMonth")}
					</div>
				)}
				{dailyAvg > 0 && (
					<span className="text-muted-foreground text-xs">
						{t("avgPerDay", { amount: formatMoney(dailyAvg) })}
					</span>
				)}
			</div>
		</div>
	);
}

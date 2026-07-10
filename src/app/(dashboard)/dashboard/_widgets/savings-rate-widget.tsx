"use client";

import { Percent, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useSettings } from "~/hooks/use-settings";
import { cn } from "~/lib/utils";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

export default function SavingsRateWidget(_props: WidgetProps) {
	const t = useTranslations("dashboard");
	const { data, isLoading } = useDashboardContext();
	const { data: settings } = useSettings();
	const { formatCurrency } = useCurrencyFormatter();
	const formatMoney = (value: number) =>
		formatCurrency(value, data.homeCurrency);

	const monthlyIncome = settings?.monthlyIncome ?? 0;

	if (isLoading.stats) {
		return (
			<div className="space-y-3 p-1">
				<Skeleton className="h-10 w-24" />
				<Skeleton className="h-4 w-32" />
			</div>
		);
	}

	if (!monthlyIncome || monthlyIncome <= 0) {
		return (
			<div className="flex flex-col items-center gap-3 p-4 text-center">
				<Settings className="h-8 w-8 text-muted-foreground" />
				<div>
					<p className="font-medium text-sm">
						{t("widgets.savingsRateWidget.noIncome")}
					</p>
					<p className="text-muted-foreground text-xs">
						{t("widgets.savingsRateWidget.noIncomeDescription")}
					</p>
				</div>
				<Button asChild size="sm" variant="outline">
					<Link href="/settings">
						{t("widgets.savingsRateWidget.goToSettings")}
					</Link>
				</Button>
			</div>
		);
	}

	const totalSpent = data.summaryStats?.totalThisMonth ?? 0;
	const savings = monthlyIncome - totalSpent;
	const savingsRate = (savings / monthlyIncome) * 100;
	const isPositive = savingsRate >= 0;

	return (
		<div className="flex flex-col gap-3 p-1">
			<div className="flex items-start justify-between">
				<div>
					<div
						className={cn(
							"font-bold text-3xl tabular-nums tracking-tight",
							isPositive ? "text-emerald-500" : "text-rose-500",
						)}
					>
						{savingsRate.toFixed(0)}%
					</div>
					<p className="text-muted-foreground text-sm">
						{isPositive
							? t("widgets.savingsRateWidget.savedThisMonth")
							: t("widgets.savingsRateWidget.overIncome")}
					</p>
				</div>
				<div
					className={cn(
						"flex h-10 w-10 items-center justify-center rounded-xl",
						isPositive ? "bg-emerald-500/10" : "bg-rose-500/10",
					)}
				>
					<Percent
						className={cn(
							"h-5 w-5",
							isPositive ? "text-emerald-500" : "text-rose-500",
						)}
					/>
				</div>
			</div>

			<div className="flex items-center justify-between text-muted-foreground text-xs">
				<span>
					{t("widgets.savingsRateWidget.income", {
						amount: formatMoney(monthlyIncome),
					})}
				</span>
				<span>
					{t("widgets.savingsRateWidget.spent", {
						amount: formatMoney(totalSpent),
					})}
				</span>
			</div>

			<div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
				<div
					className={cn(
						"h-full rounded-full transition-all",
						isPositive ? "bg-emerald-500" : "bg-rose-500",
					)}
					style={{
						width: `${Math.min(100, (totalSpent / monthlyIncome) * 100)}%`,
					}}
				/>
			</div>
		</div>
	);
}

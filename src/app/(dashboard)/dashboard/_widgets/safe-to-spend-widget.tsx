"use client";

import { ShieldCheck, Target } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

export default function SafeToSpendWidget(_props: WidgetProps) {
	const t = useTranslations("dashboard");
	const { data, isLoading } = useDashboardContext();
	const { formatCurrency } = useCurrencyFormatter();
	const formatMoney = (value: number) =>
		formatCurrency(value, data.homeCurrency);

	if (isLoading.stats) {
		return (
			<div className="space-y-3 p-1">
				<Skeleton className="h-10 w-36" />
				<Skeleton className="h-4 w-28" />
				<Skeleton className="h-4 w-24" />
			</div>
		);
	}

	const { variableBudget, variableSpent, daysInMonth, currentDay } =
		data.budgetPacing;
	const hasBudget = variableBudget > 0;

	if (!hasBudget) {
		return (
			<div className="flex flex-col items-center gap-3 p-4 text-center">
				<Target className="h-8 w-8 text-muted-foreground" />
				<div>
					<p className="font-medium text-sm">
						{t("widgets.safeToSpendWidget.noBudget")}
					</p>
					<p className="text-muted-foreground text-xs">
						{t("widgets.safeToSpendWidget.noBudgetDescription")}
					</p>
				</div>
				<Button asChild size="sm" variant="outline">
					<Link href="/budget">
						{t("widgets.safeToSpendWidget.goToBudget")}
					</Link>
				</Button>
			</div>
		);
	}

	const daysLeft = Math.max(1, daysInMonth - currentDay);
	const remaining = Math.max(0, variableBudget - variableSpent);
	const safePerDay = remaining / daysLeft;

	// How healthy is the budget? Compare safe-to-spend to ideal daily pace
	const idealDailyPace = variableBudget / daysInMonth;
	const healthRatio = idealDailyPace > 0 ? safePerDay / idealDailyPace : 1;

	const variant =
		healthRatio > 0.8
			? "emerald"
			: healthRatio > 0.4
				? "amber"
				: "rose";

	const variantStyles = {
		emerald: {
			text: "text-emerald-500",
			bg: "bg-emerald-500/10",
			icon: "text-emerald-500",
		},
		amber: {
			text: "text-amber-500",
			bg: "bg-amber-500/10",
			icon: "text-amber-500",
		},
		rose: {
			text: "text-rose-500",
			bg: "bg-rose-500/10",
			icon: "text-rose-500",
		},
	};

	const styles = variantStyles[variant];

	return (
		<div className="flex flex-col gap-3 p-1">
			<div className="flex items-start justify-between">
				<div>
					<div
						className={cn(
							"font-bold text-3xl tabular-nums tracking-tight",
							styles.text,
						)}
					>
						{formatMoney(safePerDay)}
					</div>
					<p className="text-muted-foreground text-sm">
						{t("widgets.safeToSpendWidget.perDay")}{" "}
						{t("widgets.safeToSpendWidget.forNextDays", {
							days: daysLeft,
						})}
					</p>
				</div>
				<div
					className={cn(
						"flex h-10 w-10 items-center justify-center rounded-xl",
						styles.bg,
					)}
				>
					<ShieldCheck className={cn("h-5 w-5", styles.icon)} />
				</div>
			</div>

			<div className="text-muted-foreground text-xs">
				{formatMoney(remaining)}{" "}
				{t("widgets.safeToSpendWidget.remaining")}
			</div>
		</div>
	);
}

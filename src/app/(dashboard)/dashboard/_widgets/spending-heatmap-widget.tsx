"use client";

import {
	eachDayOfInterval,
	format,
	getDay,
	startOfWeek,
	subDays,
} from "date-fns";
import { useMemo } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

const DAYS_OF_WEEK = ["", "Mon", "", "Wed", "", "Fri", ""];

function getIntensityClass(amount: number, max: number): string {
	if (amount === 0) return "bg-muted/40";
	const ratio = amount / max;
	if (ratio < 0.2) return "bg-emerald-500/20";
	if (ratio < 0.4) return "bg-emerald-500/40";
	if (ratio < 0.6) return "bg-emerald-500/60";
	if (ratio < 0.8) return "bg-emerald-500/80";
	return "bg-emerald-500";
}

export default function SpendingHeatmapWidget(_props: WidgetProps) {
	const { data, isLoading, state } = useDashboardContext();
	const { formatCurrency } = useCurrencyFormatter();

	const now = state.serverTime ?? state.now;

	const heatmapData = useMemo(() => {
		const spendingMap = new Map<string, number>();
		for (const day of data.dailySpending) {
			const key =
				typeof day.date === "string"
					? day.date
					: format(new Date(day.date), "yyyy-MM-dd");
			spendingMap.set(key, (spendingMap.get(key) ?? 0) + day.total);
		}

		const endDate = now;
		const startDate = startOfWeek(subDays(endDate, 89));
		const allDays = eachDayOfInterval({ start: startDate, end: endDate });

		let maxAmount = 0;
		const days = allDays.map((date) => {
			const key = format(date, "yyyy-MM-dd");
			const amount = spendingMap.get(key) ?? 0;
			if (amount > maxAmount) maxAmount = amount;
			return { date, key, amount, dayOfWeek: getDay(date) };
		});

		// Group into weeks
		const weeks: (typeof days)[] = [];
		let currentWeek: typeof days = [];
		for (const day of days) {
			if (day.dayOfWeek === 0 && currentWeek.length > 0) {
				weeks.push(currentWeek);
				currentWeek = [];
			}
			currentWeek.push(day);
		}
		if (currentWeek.length > 0) weeks.push(currentWeek);

		return { weeks, maxAmount };
	}, [data.dailySpending, now]);

	if (isLoading.heatmap) {
		return <Skeleton className="h-[140px] w-full rounded-xl" />;
	}

	return (
		<div className="flex gap-1">
			<div className="flex flex-col gap-1 pt-5">
				{DAYS_OF_WEEK.map((label, i) => (
					<div
						className="h-3 text-[9px] leading-3 text-muted-foreground"
						key={`label-${i}`}
					>
						{label}
					</div>
				))}
			</div>
			<div className="flex flex-1 gap-[3px] overflow-x-auto">
				{heatmapData.weeks.map((week, wi) => (
					<div className="flex flex-col gap-[3px]" key={`week-${wi}`}>
						{/* Month label on first week or when month changes */}
						<div className="h-4 text-[9px] text-muted-foreground">
							{wi === 0 || (week[0] && week[0].date.getDate() <= 7)
								? week[0]
									? format(week[0].date, "MMM")
									: ""
								: ""}
						</div>
						{Array.from({ length: 7 }).map((_, di) => {
							const day = week.find((d) => d.dayOfWeek === di);
							if (!day) {
								return (
									<div
										className="h-3 w-3 rounded-[2px]"
										key={`empty-${di}`}
									/>
								);
							}
							return (
								<Tooltip key={day.key}>
									<TooltipTrigger asChild>
										<div
											className={cn(
												"h-3 w-3 rounded-[2px] transition-colors",
												getIntensityClass(
													day.amount,
													heatmapData.maxAmount,
												),
											)}
										/>
									</TooltipTrigger>
									<TooltipContent side="top">
										<div className="text-xs">
											<div className="font-medium">
												{format(day.date, "MMM d, yyyy")}
											</div>
											<div className="tabular-nums">
												{formatCurrency(
													day.amount,
													data.homeCurrency,
												)}
											</div>
										</div>
									</TooltipContent>
								</Tooltip>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}

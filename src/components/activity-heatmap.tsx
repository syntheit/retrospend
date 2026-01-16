"use client";

import {
	eachDayOfInterval,
	endOfMonth,
	format,
	parseISO,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import { useMemo } from "react";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { formatCurrency } from "~/lib/utils";

interface ActivityData {
	date: string;
	amount: number;
	category?: string;
}

interface ActivityHeatmapProps {
	data: ActivityData[];
	title?: string;
	onDayClick?: (date: Date, hasActivity: boolean) => void;
	startDate: Date;
	endDate: Date;
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DISPLAY_DAYS = ["Mon", "Wed", "Fri"];

/**
 * Checks if an expense belongs to a category that should be spread across the month.
 */
function shouldSpreadExpense(category?: string): boolean {
	const cat = category?.toLowerCase() ?? "";
	return (
		cat.includes("rent") || cat.includes("utilities") || cat.includes("utility")
	);
}

/**
 * Returns the Tailwind CSS class for a given activity intensity.
 */
function getIntensityClass(amount: number, maxAmount: number) {
	if (amount === 0) return "bg-stone-100 border border-stone-200";
	if (maxAmount === 0) return "bg-orange-200";

	const intensity = amount / maxAmount;
	if (intensity < 0.25) return "bg-orange-200";
	if (intensity < 0.5) return "bg-orange-300";
	if (intensity < 0.75) return "bg-orange-400";
	return "bg-orange-500";
}

export function ActivityHeatmap({
	data,
	title = "Spending Activity",
	onDayClick,
	startDate,
	endDate,
}: ActivityHeatmapProps) {
	const today = useMemo(() => new Date(), []);

	const spendingMap = useMemo(() => {
		const map = new Map<string, number>();

		for (const item of data) {
			const date = parseISO(item.date);

			if (shouldSpreadExpense(item.category)) {
				const monthStart = startOfMonth(date);
				// If current month, spread only up to today
				const isCurrentMonth =
					date.getFullYear() === today.getFullYear() &&
					date.getMonth() === today.getMonth();

				const monthEnd = isCurrentMonth ? today : endOfMonth(date);

				const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
				if (days.length > 0) {
					const dailyAmount = item.amount / days.length;
					for (const day of days) {
						const key = format(day, "yyyy-MM-dd");
						map.set(key, (map.get(key) ?? 0) + dailyAmount);
					}
				}
			} else {
				const key = format(date, "yyyy-MM-dd");
				map.set(key, (map.get(key) ?? 0) + item.amount);
			}
		}
		return map;
	}, [data, today]);

	const weeks = useMemo(() => {
		const weeksArray: Array<
			Array<{ date: Date; dateKey: string; amount: number }>
		> = [];
		const firstDate = startOfWeek(startDate);
		const lastDate = startOfWeek(endDate);

		// Calculate dynamic week count based on date range
		const weekCount =
			Math.ceil(
				(lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000),
			) + 1;

		for (let i = 0; i < weekCount; i++) {
			const week: Array<{ date: Date; dateKey: string; amount: number }> = [];

			for (let j = 0; j < 7; j++) {
				const date = new Date(firstDate);
				date.setDate(firstDate.getDate() + i * 7 + j);

				if (date >= startDate && date <= endDate) {
					const dateKey = format(date, "yyyy-MM-dd");
					week.push({
						date,
						dateKey,
						amount: spendingMap.get(dateKey) ?? 0,
					});
				}
			}

			if (week.length > 0) weeksArray.push(week);
		}
		return weeksArray;
	}, [startDate, endDate, spendingMap]);

	const maxAmount = useMemo(
		() => Math.max(...Array.from(spendingMap.values()), 0),
		[spendingMap],
	);

	const monthLabels = useMemo(() => {
		const labels: Array<{ month: string; startColumn: number; span: number }> =
			[];

		// Find all unique months in the date range
		const months = new Map<string, { startWeek: number; endWeek: number }>();

		weeks.forEach((week, i) => {
			week.forEach((day) => {
				const key = format(day.date, "yyyy-MM");
				if (!months.has(key)) {
					months.set(key, { startWeek: i, endWeek: i });
				} else {
					const existing = months.get(key);
					if (existing) {
						existing.endWeek = i;
					}
				}
			});
		});

		// Convert to labels with column positions
		months.forEach((value, key) => {
			const [year = "0", month = "0"] = key.split("-");
			const date = new Date(
				Number.parseInt(year, 10),
				Number.parseInt(month, 10) - 1,
				1,
			);
			const monthName = format(date, "MMM");
			const startColumn = value.startWeek + 1; // Grid columns are 1-indexed
			const span = value.endWeek - value.startWeek + 1;

			labels.push({
				month: monthName,
				startColumn,
				span,
			});
		});

		return labels;
	}, [weeks]);

	return (
		<div className="space-y-4">
			<h3 className="font-semibold text-lg">{title}</h3>

			<TooltipProvider>
				<div className="overflow-x-auto pb-4">
					<div className="inline-flex min-w-full flex-col gap-2">
						{/* Month labels row */}
						<div className="flex items-start gap-1">
							<div className="w-8 shrink-0" />{" "}
							{/* Spacer for day labels */}
							<div className="flex flex-1 gap-1">
								{monthLabels.map(({ month, span }) => (
									<div
										key={month}
										className="shrink-0 text-muted-foreground text-xs"
										style={{
											width: `calc(${span} * (12px + 4px) - 4px)`, // (w-3 + gap-1) * columns - last gap
										}}
									>
										{month}
									</div>
								))}
							</div>
						</div>

						{/* Heatmap with day labels */}
						<div className="flex gap-1">
							{/* Day labels column */}
							<div className="flex w-8 shrink-0 flex-col gap-1">
								{DAYS_OF_WEEK.map((day) => (
									<div
										className={`flex h-3 items-center text-muted-foreground text-xs ${
											DISPLAY_DAYS.includes(day) ? "" : "invisible"
										}`}
										key={day}
									>
										{day}
									</div>
								))}
							</div>

							{/* Heatmap grid */}
							<div className="flex gap-1">
								{weeks.map((week) => (
									<div
										className="flex shrink-0 flex-col gap-1"
										key={week[0]?.dateKey}
									>
										{week.map((day) => (
											<Tooltip key={day.dateKey}>
												<TooltipTrigger asChild>
													<button
														className={`h-3 w-3 shrink-0 cursor-pointer rounded-sm border-none p-0 transition-colors ${getIntensityClass(day.amount, maxAmount)}`}
														onClick={() =>
															onDayClick?.(day.date, day.amount > 0)
														}
														type="button"
													/>
												</TooltipTrigger>
												<TooltipContent className="pointer-events-none">
													<div className="text-sm">
														<div className="font-medium">
															{format(day.date, "MMM d, yyyy")}
														</div>
														<div className="text-muted-foreground">
															{formatCurrency(day.amount)}
														</div>
													</div>
												</TooltipContent>
											</Tooltip>
										))}
										{/* Fill gaps for partial weeks */}
										{Array.from({ length: 7 - week.length }, (_, i) => (
											<div
												className="h-3 w-3 shrink-0"
												key={`empty-${week[0]?.dateKey}-${i}`}
											/>
										))}
									</div>
								))}
							</div>
						</div>

						{/* Legend */}
						<div className="flex items-center gap-2 text-muted-foreground text-xs">
							<span>Less</span>
							<div className="flex gap-1">
								<div className="h-3 w-3 rounded-sm border border-stone-200 bg-stone-100" />
								{[200, 300, 400, 500].map((level) => (
									<div
										className={`h-3 w-3 rounded-sm bg-orange-${level}`}
										key={level}
									/>
								))}
							</div>
							<span>More</span>
						</div>
					</div>
				</div>
			</TooltipProvider>
		</div>
	);
}

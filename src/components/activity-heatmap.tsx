"use client";

import {
	eachDayOfInterval,
	endOfMonth,
	format,
	getYear,
	parseISO,
	startOfYear,
} from "date-fns";
import { useMemo } from "react";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";

interface ActivityData {
	date: string;
	amount: number;
	category?: string;
}

interface ActivityHeatmapProps {
	data: ActivityData[];
	title?: string;
	onDayClick?: (date: Date, hasActivity: boolean) => void;
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DISPLAY_DAYS = ["Mon", "Wed", "Fri"];

export function ActivityHeatmap({
	data,
	title = "Annual Spending Activity",
	onDayClick,
}: ActivityHeatmapProps) {
	const currentYear = getYear(new Date());

	// Process data into a map of date strings to amounts
	const spendingMap = useMemo(() => {
		const map = new Map<string, number>();
		const currentDate = new Date();

		for (const item of data) {
			const expenseDate = parseISO(item.date);
			const categoryName = item.category?.toLowerCase() || "";

			// Check if this is a rent or utilities expense that should be spread across the month
			const isMonthlyExpense =
				categoryName.includes("rent") ||
				categoryName.includes("utilities") ||
				categoryName.includes("utility");

			if (isMonthlyExpense) {
				// Determine the date range for spreading the expense
				const monthStart = new Date(
					expenseDate.getFullYear(),
					expenseDate.getMonth(),
					1,
				);
				let monthEnd: Date;

				// If this is the current month, only spread up to today
				if (
					expenseDate.getFullYear() === currentDate.getFullYear() &&
					expenseDate.getMonth() === currentDate.getMonth()
				) {
					monthEnd = new Date(
						currentDate.getFullYear(),
						currentDate.getMonth(),
						currentDate.getDate(),
					);
				} else {
					// For past months, spread across the entire month
					monthEnd = endOfMonth(expenseDate);
				}

				const daysInRange = eachDayOfInterval({
					start: monthStart,
					end: monthEnd,
				});

				// Only spread if we have days in the range
				if (daysInRange.length > 0) {
					// Calculate daily amount (divide by number of days in range)
					const dailyAmount = item.amount / daysInRange.length;

					// Add the daily amount to each day in the range
					for (const day of daysInRange) {
						const dateKey = format(day, "yyyy-MM-dd");
						map.set(dateKey, (map.get(dateKey) ?? 0) + dailyAmount);
					}
				}
			} else {
				// For regular expenses, add to the specific date
				const dateKey = format(expenseDate, "yyyy-MM-dd");
				map.set(dateKey, (map.get(dateKey) ?? 0) + item.amount);
			}
		}

		return map;
	}, [data]);

	// Generate all weeks for the year
	const weeks = useMemo(() => {
		const yearStart = startOfYear(new Date(currentYear, 0, 1));
		const weeksArray: Array<
			Array<{ date: Date; dateKey: string; amount: number }>
		> = [];

		// Create 52 weeks + 1 extra for year wraparound
		for (let weekIndex = 0; weekIndex < 53; weekIndex++) {
			const week: Array<{ date: Date; dateKey: string; amount: number }> = [];

			for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
				const date = new Date(yearStart);
				date.setDate(yearStart.getDate() + weekIndex * 7 + dayIndex);

				// Only include dates from the current year
				if (getYear(date) === currentYear) {
					const dateKey = format(date, "yyyy-MM-dd");
					const amount = spendingMap.get(dateKey) ?? 0;
					week.push({ date, dateKey, amount });
				}
			}

			if (week.length > 0) {
				weeksArray.push(week);
			}
		}

		return weeksArray;
	}, [currentYear, spendingMap]);

	// Calculate color intensity levels
	const maxAmount = useMemo(() => {
		return Math.max(...Array.from(spendingMap.values()), 0);
	}, [spendingMap]);

	const getIntensityClass = (amount: number) => {
		if (amount === 0) return "bg-stone-100 border border-stone-200";
		if (maxAmount === 0) return "bg-orange-200";

		const intensity = amount / maxAmount;
		if (intensity < 0.25) return "bg-orange-200";
		if (intensity < 0.5) return "bg-orange-300";
		if (intensity < 0.75) return "bg-orange-400";
		return "bg-orange-500";
	};

	const formatAmount = (amount: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			maximumFractionDigits: 0,
		}).format(amount);
	};

	return (
		<div className="space-y-4">
			<h3 className="font-semibold text-lg">{title}</h3>

			<TooltipProvider>
				<div className="flex w-fit flex-col gap-2">
					{/* Month labels */}
					<div className="flex gap-2">
						{/* Spacer for day labels column */}
						<div className="h-5 w-8" />
						{/* Month labels positioned over the grid */}
						<div className="relative h-5 flex-1">
							{Array.from({ length: 12 }, (_, monthIndex) => {
								const monthDate = new Date(currentYear, monthIndex, 1);
								const monthName = format(monthDate, "MMM");

								// Find the week that contains the 1st of this month
								const weekIndex = weeks.findIndex((week) =>
									week.some(
										(day) =>
											day.date.getFullYear() === currentYear &&
											day.date.getMonth() === monthIndex &&
											day.date.getDate() === 1,
									),
								);

								if (weekIndex === -1) return null;

								// Calculate position as percentage across the grid width
								const positionPercent =
									(weekIndex / Math.max(1, weeks.length - 1)) * 100;

								return (
									<div
										className="absolute top-0 text-muted-foreground text-xs"
										key={monthName}
										style={{
											left: `${positionPercent}%`,
										}}
									>
										{monthName}
									</div>
								);
							})}
						</div>
					</div>

					{/* Heatmap grid */}
					<div className="flex gap-2">
						{/* Day labels */}
						<div className="flex w-8 flex-col gap-1">
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

						{/* Weeks grid */}
						<div className="grid grid-cols-53 gap-1">
							{weeks.map((week) => (
								<div className="flex flex-col gap-1" key={week[0]?.dateKey}>
									{week.map((day) => (
										<Tooltip key={day.dateKey}>
											<TooltipTrigger asChild>
												<button
													className={`h-3 w-3 cursor-pointer rounded-sm border-none p-0 transition-colors ${getIntensityClass(day.amount)}`}
													onClick={() => onDayClick?.(day.date, day.amount > 0)}
													title={`${format(day.date, "MMM d, yyyy")}: ${formatAmount(day.amount)}`}
													type="button"
												/>
											</TooltipTrigger>
											<TooltipContent className="pointer-events-none">
												<div className="text-sm">
													<div className="font-medium">
														{format(day.date, "MMM d, yyyy")}
													</div>
													<div className="text-muted-foreground">
														{formatAmount(day.amount)}
													</div>
												</div>
											</TooltipContent>
										</Tooltip>
									))}
									{/* Fill empty cells for weeks with fewer than 7 days */}
									{Array.from({ length: 7 - week.length }, (_, i) => (
										<div
											className="h-3 w-3"
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
							<div className="h-3 w-3 rounded-sm bg-orange-200" />
							<div className="h-3 w-3 rounded-sm bg-orange-300" />
							<div className="h-3 w-3 rounded-sm bg-orange-400" />
							<div className="h-3 w-3 rounded-sm bg-orange-500" />
						</div>
						<span>More</span>
					</div>
				</div>
			</TooltipProvider>
		</div>
	);
}

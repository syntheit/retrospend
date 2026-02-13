"use client";

import { format, isSameDay, subMonths, addMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { BrandIcon } from "~/components/ui/BrandIcon";
import { Button } from "~/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useRecurringCalendar } from "~/hooks/use-recurring-calendar";
import { cn } from "~/lib/utils";
import { type RecurringTemplate } from "~/types/recurring";

interface RecurringCalendarProps {
	templates?: RecurringTemplate[];
	loading: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RecurringCalendar({
	templates,
	loading,
}: RecurringCalendarProps) {
	const [currentMonth, setCurrentMonth] = useState(new Date());
	const { formatCurrency } = useCurrencyFormatter();
	const calendarDays = useRecurringCalendar(templates, currentMonth);

	const handlePreviousMonth = () => {
		setCurrentMonth(subMonths(currentMonth, 1));
	};

	const handleNextMonth = () => {
		setCurrentMonth(addMonths(currentMonth, 1));
	};

	const handleToday = () => {
		setCurrentMonth(new Date());
	};

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="h-12 animate-pulse rounded-lg bg-muted" />
				<div className="h-96 animate-pulse rounded-lg bg-muted" />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Calendar Header */}
			<div className="flex items-center justify-between">
				<h2 className="font-semibold text-2xl">
					{format(currentMonth, "MMMM yyyy")}
				</h2>
				<div className="flex items-center gap-2">
					<Button onClick={handleToday} size="sm" variant="outline">
						Today
					</Button>
					<Button onClick={handlePreviousMonth} size="icon" variant="outline">
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<Button onClick={handleNextMonth} size="icon" variant="outline">
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Calendar Grid */}
			<div className="overflow-hidden rounded-lg border bg-card">
				{/* Weekday Headers */}
				<div className="grid grid-cols-7 border-b bg-muted/50">
					{WEEKDAYS.map((day) => (
						<div
							className="border-r p-2 text-center font-medium text-muted-foreground text-sm last:border-r-0"
							key={day}
						>
							{day}
						</div>
					))}
				</div>

				{/* Calendar Days */}
				<div className="grid grid-cols-7">
					{calendarDays.map((dayInfo) => {
						const { date, isCurrentMonth, templates: dayTemplates } = dayInfo;
						const dateKey = format(date, "yyyy-MM-dd");
						const isToday = isSameDay(date, new Date());

						return (
							<div
								className={cn(
									"aspect-square border-r border-b p-2 transition-colors last:border-r-0 hover:bg-accent/50",
									isToday && "bg-primary/10 ring-1 ring-inset ring-primary/20",
									!isCurrentMonth && "bg-muted/20 opacity-50"
								)}
								key={dateKey}
							>
								<div className="flex h-full flex-col">
									{/* Day number */}
									<div
										className={cn(
											"mb-2 flex h-6 w-6 items-center justify-center rounded-full text-sm",
											isToday
												? "bg-primary font-semibold text-primary-foreground"
												: "text-foreground"
										)}
									>
										{date.getDate()}
									</div>

									{/* Payment icons */}
									{dayTemplates.length > 0 && (
										<TooltipProvider>
											<div className="flex flex-wrap gap-2">
												{dayTemplates.map((template) => (
													<Tooltip key={template.id}>
														<TooltipTrigger asChild>
															<div className="group flex cursor-pointer flex-col items-center gap-1">
																<BrandIcon
																	className="h-5 w-5 rounded-full shadow-sm transition-transform group-hover:scale-110"
																	name={template.name}
																	size={20}
																	url={template.websiteUrl}
																/>
																<span className="hidden font-mono text-[10px] text-muted-foreground leading-none md:block">
																	{formatCurrency(
																		Number(template.amount),
																		template.currency,
																	)}
																</span>
															</div>
														</TooltipTrigger>
														<TooltipContent>
															<div className="text-center">
																<p className="font-medium">{template.name}</p>
																<p className="text-xs text-muted-foreground">
																	{formatCurrency(
																		Number(template.amount),
																		template.currency,
																	)}
																</p>
															</div>
														</TooltipContent>
													</Tooltip>
												))}
											</div>
										</TooltipProvider>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

"use client";

import { addDays, format, isSameDay, isToday, startOfToday } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useMemo, useRef } from "react";
import { BrandIcon } from "~/components/ui/BrandIcon";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import type { RecurringTemplate } from "~/types/recurring";

interface RenewalTimelineProps {
	templates?: RecurringTemplate[];
	loading: boolean;
	onEdit: (template: RecurringTemplate) => void;
}

interface TimelineDay {
	date: Date;
	isToday: boolean;
	templates: RecurringTemplate[];
	totalAmount: number;
}

export function RenewalTimeline({
	templates,
	loading,
	onEdit,
}: RenewalTimelineProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const scrollRef = useRef<HTMLDivElement>(null);

	const timelineDays = useMemo(() => {
		const today = startOfToday();
		const active = (templates ?? []).filter((t) => t.isActive);
		const days: TimelineDay[] = [];

		for (let i = 0; i < 30; i++) {
			const date = addDays(today, i);
			const dayTemplates = active.filter((t) =>
				isSameDay(new Date(t.nextDueDate), date),
			);
			const todayFlag = isToday(date);

			// Only include days that have templates or are today
			if (dayTemplates.length > 0 || todayFlag) {
				days.push({
					date,
					isToday: todayFlag,
					templates: dayTemplates,
					totalAmount: dayTemplates.reduce(
						(sum, t) => sum + Number(t.amount),
						0,
					),
				});
			}
		}

		return days;
	}, [templates]);

	if (loading) {
		return (
			<div className="space-y-3">
				<div className="h-4 w-32 animate-pulse rounded bg-muted/40" />
				<div className="h-24 animate-pulse rounded-xl bg-muted/20" />
			</div>
		);
	}

	const hasUpcoming = timelineDays.some((d) => d.templates.length > 0);
	if (!hasUpcoming) return null;

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<CalendarClock className="h-4 w-4 text-muted-foreground" />
				<h3 className="font-semibold text-sm">Renewal Timeline</h3>
				<span className="text-muted-foreground text-xs">Next 30 days</span>
			</div>

			<div
				className="-mx-1 overflow-x-auto px-1 pb-2"
				ref={scrollRef}
			>
				<div className="flex min-w-min gap-3">
					{timelineDays.map((day) => (
						<div
							className="flex flex-col items-center gap-2"
							key={day.date.toISOString()}
							style={{ minWidth: 96 }}
						>
							{/* Date marker */}
							<div
								className={cn(
									"rounded-full px-2.5 py-0.5 font-medium text-xs",
									day.isToday
										? "bg-primary text-primary-foreground"
										: "bg-muted/50 text-muted-foreground",
								)}
							>
								{day.isToday ? "Today" : format(day.date, "MMM d")}
							</div>

							{/* Timeline dot */}
							<div className="relative flex w-full items-center justify-center">
								<div className="absolute inset-x-0 h-px bg-border" />
								<div
									className={cn(
										"relative z-10 h-2.5 w-2.5 rounded-full border-2",
										day.templates.length > 0
											? "border-primary bg-primary"
											: "border-muted-foreground/30 bg-background",
									)}
								/>
							</div>

							{/* Template cards */}
							<div className="flex w-full flex-col gap-1">
								{day.templates.map((t) => (
									<button
										className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-border/50 bg-card p-2 text-left transition-colors hover:bg-accent/50"
										key={t.id}
										onClick={() => onEdit(t)}
										type="button"
									>
										<BrandIcon
											className="h-4 w-4 shrink-0 rounded-full"
											name={t.name}
											size={16}
											url={t.websiteUrl}
										/>
										<div className="min-w-0">
											<p className="truncate font-medium text-xs">
												{t.name}
											</p>
											<p className="text-[10px] text-muted-foreground tabular-nums">
												{formatCurrency(Number(t.amount), t.currency)}
											</p>
										</div>
									</button>
								))}
								{day.isToday && day.templates.length === 0 && (
									<p className="text-center text-[10px] text-muted-foreground">
										No renewals
									</p>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

"use client";

import { addDays, format, isSameDay } from "date-fns";
import { CalendarCheck } from "lucide-react";
import * as React from "react";
import { BrandIcon } from "~/components/ui/BrandIcon";
import { Calendar } from "~/components/ui/calendar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import type { RecurringTemplate } from "~/types/recurring";

interface RecurringCalendarProps {
	templates?: RecurringTemplate[];
	loading: boolean;
}

export function RecurringCalendar({
	templates,
	loading,
}: RecurringCalendarProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
		undefined,
	);

	const next7Days = React.useMemo(
		() => Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)),
		[],
	);

	const upcomingPayments = React.useMemo(
		() =>
			next7Days
				.flatMap((date: Date) => {
					return (templates ?? [])
						.filter((t: RecurringTemplate) =>
							isSameDay(new Date(t.nextDueDate), date),
						)
						.map((t: RecurringTemplate) => ({ ...t, date }));
				})
				.sort((a, b) => a.date.getTime() - b.date.getTime()),
		[next7Days, templates],
	);

	const paymentsOnSelectedDate = React.useMemo(
		() =>
			selectedDate
				? (templates ?? [])
						.filter((t: RecurringTemplate) =>
							isSameDay(new Date(t.nextDueDate), selectedDate),
						)
						.map((t: RecurringTemplate) => ({ ...t, date: selectedDate }))
				: [],
		[selectedDate, templates],
	);

	const displayedPayments = selectedDate
		? paymentsOnSelectedDate
		: upcomingPayments;

	const paymentDates = React.useMemo(
		() =>
			(templates ?? []).map((t: RecurringTemplate) => new Date(t.nextDueDate)),
		[templates],
	);

	if (loading) {
		return (
			<div className="mx-auto w-full max-w-[320px] space-y-4 rounded-xl border border-border/40 bg-transparent p-4">
				<div className="flex justify-center">
					<div className="h-[240px] w-full animate-pulse rounded-lg bg-muted/30" />
				</div>
				<div className="h-[1px] bg-border/40" />
				<div className="space-y-3">
					<div className="h-3 w-20 animate-pulse rounded bg-muted/40" />
					<div className="space-y-2">
						<div className="h-10 animate-pulse rounded bg-muted/20" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[320px] flex-col overflow-hidden rounded-xl border border-border/40 bg-transparent shadow-sm">
			{/* Calendar View */}
			<div className="flex justify-center p-4 pb-2">
				<Calendar
					className="pointer-events-auto p-0"
					classNames={{
						months: "relative w-full",
						month: "w-full space-y-1",
						table: "w-full border-collapse",
						head_row: "mt-1 flex w-full",
						weekday:
							"flex-1 w-9 font-normal text-[0.75rem] text-muted-foreground",
						row: "mt-0.5 flex w-full",
						day: cn(
							"relative mx-auto flex h-8 w-8 cursor-pointer items-center justify-center p-0 font-normal transition-colors aria-selected:opacity-100",
							"rounded-full hover:bg-primary/10 hover:text-primary",
						),
						selected:
							"rounded-full bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground hover:bg-primary hover:text-primary-foreground",
						today: "font-bold text-primary",
						month_caption: "flex h-8 items-center justify-center",
						caption_label: "font-medium text-sm",
						nav: "absolute inset-x-0 top-0 flex h-8 w-full items-center justify-between pointer-events-none",
						button_previous:
							"h-7 w-7 transition-colors bg-transparent text-muted-foreground hover:text-foreground pointer-events-auto",
						button_next:
							"h-7 w-7 transition-colors bg-transparent text-muted-foreground hover:text-foreground pointer-events-auto",
					}}
					mode="single"
					modifiers={{
						payment: paymentDates,
					}}
					modifiersClassNames={{
						payment:
							"after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
					}}
					onSelect={setSelectedDate}
					selected={selectedDate}
				/>
			</div>

			{/* Details Section / Agenda Footer Panel */}
			<div className="mt-2 border-border/50 border-t bg-secondary/5 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h3 className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
						{selectedDate
							? `Payments on ${format(selectedDate, "MMM d")}`
							: "Upcoming Payments"}
					</h3>
					{selectedDate && (
						<button
							className="font-medium text-[10px] text-muted-foreground transition-colors hover:text-foreground"
							onClick={() => setSelectedDate(undefined)}
							type="button"
						>
							Clear
						</button>
					)}
				</div>

				<div className="min-h-[100px] space-y-1.5">
					{displayedPayments.length > 0 ? (
						displayedPayments.map((payment: RecurringTemplate) => (
							<div
								className="group flex items-center justify-between py-1 text-sm"
								key={payment.id}
							>
								<div className="flex min-w-0 items-center gap-2">
									<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border/20 bg-background/50">
										<BrandIcon
											className="h-4 w-4 rounded-full"
											name={payment.name}
											size={16}
											url={payment.websiteUrl}
										/>
									</div>
									<span className="truncate font-medium text-foreground">
										{payment.name}
									</span>
								</div>
								<div className="mx-2 flex-1 translate-y-[-2px] border-border/50 border-b border-dotted" />
								<span className="shrink-0 font-bold text-foreground tabular-nums">
									{formatCurrency(Number(payment.amount), payment.currency)}
								</span>
							</div>
						))
					) : (
						<div className="flex flex-col items-center justify-center py-6 text-center">
							<div className="mb-2 rounded-full bg-muted/20 p-2">
								<CalendarCheck className="h-5 w-5 text-muted-foreground/40" />
							</div>
							<p className="text-muted-foreground text-xs italic">
								No payments due.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

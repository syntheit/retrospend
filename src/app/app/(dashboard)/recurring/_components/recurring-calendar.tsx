"use client";
import * as React from "react";
import { addDays, format, isSameDay } from "date-fns";
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
				.flatMap((date) => {
					return (templates ?? [])
						.filter((t) => isSameDay(new Date(t.nextDueDate), date))
						.map((t) => ({ ...t, date }));
				})
				.sort((a, b) => a.date.getTime() - b.date.getTime()),
		[next7Days, templates],
	);

	const paymentsOnSelectedDate = React.useMemo(
		() =>
			selectedDate
				? (templates ?? [])
						.filter((t) => isSameDay(new Date(t.nextDueDate), selectedDate))
						.map((t) => ({ ...t, date: selectedDate }))
				: [],
		[selectedDate, templates],
	);

	const displayedPayments = selectedDate
		? paymentsOnSelectedDate
		: upcomingPayments;

	const paymentDates = React.useMemo(
		() => (templates ?? []).map((t) => new Date(t.nextDueDate)),
		[templates],
	);


	if (loading) {
		return (
			<div className="space-y-6">
				<div className="h-[300px] animate-pulse rounded-xl bg-muted" />
				<div className="space-y-2">
					<div className="h-12 animate-pulse rounded-lg bg-muted" />
					<div className="h-12 animate-pulse rounded-lg bg-muted" />
				</div>
			</div>
		);
	}


	return (
		<div className="space-y-6">
			<div className="rounded-xl border border-border bg-card p-2 shadow-sm">
				<Calendar
					className="w-full p-0"
					classNames={{
						months: "w-full",
						month: "w-full space-y-4",
						table: "w-full border-collapse space-y-1",
						head_row: "flex w-full",
						head_cell: cn(
							"w-full rounded-md font-normal text-[0.8rem] text-muted-foreground",
						),
						row: cn("mt-2 flex w-full"),
						cell: cn(
							"relative w-full p-0 text-center text-sm focus-within:relative focus-within:z-20",
						),
						day: cn(
							"mx-auto h-9 w-9 p-0 font-normal aria-selected:opacity-100",
						),
					}}
					mode="single"
					selected={selectedDate}
					onSelect={setSelectedDate}
					modifiers={{
						payment: paymentDates,
					}}
					modifiersClassNames={{
						payment: cn(
							"relative after:absolute after:bottom-1.5 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-blue-500 after:content-['']",
						),
					}}
				/>
			</div>

			<div className="space-y-3">
				<div className="flex items-center justify-between px-1">
					<h3 className="font-semibold text-sm">
						{selectedDate
							? `Payments on ${format(selectedDate, "MMM d")}`
							: "Next 7 Days"}
					</h3>
					{selectedDate && (
						<button
							type="button"
							onClick={() => setSelectedDate(undefined)}
							className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							Clear
						</button>
					)}
				</div>
				<div className="space-y-2">
					{displayedPayments.length > 0 ? (
						displayedPayments.map((payment) => (
							<div
								className="flex items-center justify-between rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-accent/50"
								key={payment.id}
							>
								<div className="flex flex-col gap-0.5">
									<span className="font-medium text-sm leading-none">
										{payment.name}
									</span>
									<span className="text-muted-foreground text-xs">
										{format(payment.date, "MMM d")}
									</span>
								</div>
								<div className="text-right">
									<span className="font-bold text-sm tabular-nums">
										{formatCurrency(Number(payment.amount), payment.currency)}
									</span>
								</div>
							</div>
						))
					) : (
						<div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/30 px-1 py-8 text-center">
							<p className="text-muted-foreground text-xs italic">
								{selectedDate
									? "No payments on this day"
									: "No payments in the next 7 days"}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

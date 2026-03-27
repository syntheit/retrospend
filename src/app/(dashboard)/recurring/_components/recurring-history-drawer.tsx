"use client";

import { Receipt } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CategoryChip } from "~/components/category-chip";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { formatExpenseDate } from "~/lib/format";
import { FREQUENCY_LABELS } from "~/lib/recurring";
import { api } from "~/trpc/react";

interface RecurringHistoryDrawerProps {
	templateId: string | null;
	onClose: () => void;
}

export function RecurringHistoryDrawer({
	templateId,
	onClose,
}: RecurringHistoryDrawerProps) {
	const isOpen = templateId !== null;
	const { formatCurrency } = useCurrencyFormatter();

	const { data, isLoading, isError, refetch } = api.recurring.get.useQuery(
		{ id: templateId ?? "" },
		{ enabled: !!templateId },
	);

	const expenses = data?.expenses ?? [];
	const totalSpent = expenses.reduce(
		(sum, e) => sum + Number(e.amount),
		0,
	);

	return (
		<Sheet onOpenChange={(open) => !open && onClose()} open={isOpen}>
			<SheetContent
				aria-label="Payment history"
				className="w-full gap-0 sm:max-w-full md:max-w-[420px] lg:max-w-[480px]"
				side="right"
			>
				<SheetHeader className="border-b px-6 py-4 pr-12">
					<SheetTitle>Payment History</SheetTitle>
					<SheetDescription className="sr-only">
						{data
							? `Payment history for ${data.name}`
							: "Loading payment history"}
					</SheetDescription>
					{data && (
						<div className="space-y-1.5">
							<p className="font-medium text-sm">{data.name}</p>
							<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
								<Badge variant="secondary" className="text-[10px]">
									{FREQUENCY_LABELS[data.frequency] ?? data.frequency}
								</Badge>
								{data.category && (
									<CategoryChip
										color={data.category.color}
										name={data.category.name}
									/>
								)}
							</div>
						</div>
					)}
				</SheetHeader>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					{isLoading && (
						<div className="space-y-3 pt-2">
							{[0, 1, 2, 3].map((i) => (
								<div className="flex items-center justify-between" key={i}>
									<Skeleton
										className="h-4 w-32"
										style={{ animationDelay: `${i * 50}ms` }}
									/>
									<Skeleton
										className="h-4 w-20"
										style={{ animationDelay: `${i * 50}ms` }}
									/>
								</div>
							))}
						</div>
					)}

					{isError && (
						<div className="flex flex-col items-center justify-center gap-3 py-12">
							<p className="text-muted-foreground text-sm">
								Couldn&apos;t load payment history
							</p>
							<Button
								onClick={() => void refetch()}
								size="sm"
								variant="outline"
							>
								Try again
							</Button>
						</div>
					)}

					{data && expenses.length === 0 && (
						<div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
							<Receipt className="h-8 w-8 text-muted-foreground/40" />
							<p className="text-muted-foreground text-sm">
								No payment history yet
							</p>
							<p className="text-muted-foreground/60 text-xs">
								Payments will appear here as they are created.
							</p>
						</div>
					)}

					{data && expenses.length > 0 && (
						<>
							{/* Summary */}
							<div className="mb-4 grid grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3">
								<div className="text-center">
									<p className="font-semibold text-sm tabular-nums">
										{formatCurrency(totalSpent, data.currency)}
									</p>
									<p className="text-muted-foreground text-[10px]">
										Total Spent
									</p>
								</div>
								<div className="text-center">
									<p className="font-semibold text-sm tabular-nums">
										{expenses.length}
									</p>
									<p className="text-muted-foreground text-[10px]">Payments</p>
								</div>
								<div className="text-center">
									<p className="font-semibold text-sm tabular-nums">
										{formatCurrency(
											totalSpent / expenses.length,
											data.currency,
										)}
									</p>
									<p className="text-muted-foreground text-[10px]">Average</p>
								</div>
							</div>

							{/* Expense list */}
							<div className="space-y-1">
								{expenses.map((expense) => (
									<div
										className="flex items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-muted/40"
										key={expense.id}
									>
										<div className="min-w-0">
											<p className="truncate text-sm">{expense.title}</p>
											<p className="text-muted-foreground text-xs">
												{formatExpenseDate(new Date(expense.date))}
											</p>
										</div>
										<span className="shrink-0 font-medium text-sm tabular-nums">
											{formatCurrency(Number(expense.amount), data.currency)}
										</span>
									</div>
								))}
							</div>
						</>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

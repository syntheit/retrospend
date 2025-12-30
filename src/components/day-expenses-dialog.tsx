"use client";

import { format } from "date-fns";
import { useMemo } from "react";
import { Badge } from "~/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import {
	cn,
	convertExpenseAmountForDisplay,
	normalizeExpenses,
} from "~/lib/utils";

interface Expense {
	id: string;
	title: string;
	amount: number;
	currency: string;
	exchangeRate: number | null;
	amountInUSD: number;
	date: Date;
	location?: string | null;
	description?: string | null;
	categoryId?: string | null;
	category?: {
		id: string;
		name: string;
		color: string;
	} | null;
}

interface DayExpensesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedDate: Date | null;
	expenses: Expense[];
	baseCurrency: string;
	liveRateToBaseCurrency: number | null;
	isLoading?: boolean;
}

export function DayExpensesDialog({
	open,
	onOpenChange,
	selectedDate,
	expenses,
	baseCurrency,
	liveRateToBaseCurrency,
	isLoading = false,
}: DayExpensesDialogProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const formattedDate = selectedDate
		? format(selectedDate, "EEEE, MMMM d, yyyy")
		: "";

	const normalizedExpenses = useMemo(
		() => normalizeExpenses(expenses),
		[expenses],
	);

	const totalAmount = useMemo(() => {
		return normalizedExpenses.reduce(
			(sum, expense) =>
				sum +
				convertExpenseAmountForDisplay(
					expense,
					baseCurrency,
					liveRateToBaseCurrency,
				),
			0,
		);
	}, [normalizedExpenses, baseCurrency, liveRateToBaseCurrency]);

	const formatBaseCurrencyAmount = (amount: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: baseCurrency,
			maximumFractionDigits: 2,
		}).format(amount);
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[80vh] max-w-2xl">
				<DialogHeader>
					<DialogTitle>{formattedDate}</DialogTitle>
					<DialogDescription>
						{expenses.length === 0 ? (
							"No expenses recorded for this day"
						) : (
							<>
								{expenses.length} expense{expenses.length === 1 ? "" : "s"}{" "}
								totaling{" "}
								<span className="font-semibold">
									{formatBaseCurrencyAmount(totalAmount)}
								</span>
							</>
						)}
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<div className="text-muted-foreground">Loading expenses...</div>
					</div>
				) : expenses.length === 0 ? (
					<div className="flex items-center justify-center py-8">
						<div className="text-muted-foreground">
							No expenses found for this day.
						</div>
					</div>
				) : (
					<div className="max-h-[60vh] overflow-y-auto">
						<div className="space-y-3">
							{normalizedExpenses.map((expense) => (
								<div
									className="flex items-start justify-between rounded-lg border bg-muted/30 p-4"
									key={expense.id}
								>
									<div className="min-w-0 flex-1">
										<div className="mb-1 flex items-center gap-2">
											<h4 className="truncate font-medium">{expense.title}</h4>
											{expense.category && (
												<Badge
													className={cn(
														"text-xs",
														CATEGORY_COLOR_MAP[
															expense.category
																.color as keyof typeof CATEGORY_COLOR_MAP
														] || "bg-gray-100 text-gray-800",
													)}
												>
													{expense.category.name}
												</Badge>
											)}
										</div>
										<div className="flex items-center gap-4 text-muted-foreground text-sm">
											<span>
												{formatBaseCurrencyAmount(
													convertExpenseAmountForDisplay(
														expense,
														baseCurrency,
														liveRateToBaseCurrency,
													),
												)}
												{expense.currency !== baseCurrency && (
													<span className="ml-1">
														({formatCurrency(expense.amount, expense.currency)})
													</span>
												)}
											</span>
											{expense.location && (
												<span className="truncate">📍 {expense.location}</span>
											)}
											<span>{format(expense.date, "h:mm a")}</span>
										</div>
										{expense.description && (
											<p className="mt-1 truncate text-muted-foreground text-sm">
												{expense.description}
											</p>
										)}
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

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
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn } from "~/lib/utils";

interface Expense {
	id: string;
	title: string;
	amount: number;
	currency: string;
	amountInUSD: number;
	date: Date;
	location?: string | null;
	description?: string | null;
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
	isLoading?: boolean;
}

export function DayExpensesDialog({
	open,
	onOpenChange,
	selectedDate,
	expenses,
	isLoading = false,
}: DayExpensesDialogProps) {
	const formattedDate = selectedDate
		? format(selectedDate, "EEEE, MMMM d, yyyy")
		: "";

	const totalAmount = useMemo(() => {
		return expenses.reduce(
			(sum, expense) => sum + (expense.amountInUSD ?? expense.amount),
			0,
		);
	}, [expenses]);

	const formatAmount = (amount: number, currency: string) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: currency,
			maximumFractionDigits: 2,
		}).format(amount);
	};

	const formatUSDAmount = (amount: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
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
									{formatUSDAmount(totalAmount)}
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
							{expenses.map((expense) => (
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
												{formatAmount(expense.amount, expense.currency)}
												{expense.currency !== "USD" && (
													<span className="ml-1">
														(
														{formatUSDAmount(
															expense.amountInUSD ?? expense.amount,
														)}
														)
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

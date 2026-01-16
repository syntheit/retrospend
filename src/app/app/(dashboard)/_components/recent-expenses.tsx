"use client";

import { format } from "date-fns";
import Link from "next/link";
import { memo } from "react";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import type { NormalizedExpense } from "~/lib/utils";
import { cn, convertExpenseAmountForDisplay } from "~/lib/utils";

interface RecentExpensesProps {
	expensesLoading: boolean;
	recentExpenses: NormalizedExpense[];
	homeCurrency: string;
	liveRateToBaseCurrency: number | null;
	formatCurrency: (amount: number, currency?: string) => string;
}

export function RecentExpenses({
	expensesLoading,
	recentExpenses,
	homeCurrency,
	liveRateToBaseCurrency,
	formatCurrency,
}: RecentExpensesProps) {
	if (expensesLoading) {
		return (
			<RecentExpensesCard>
				<div className="space-y-2">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			</RecentExpensesCard>
		);
	}

	if (recentExpenses.length === 0) {
		return (
			<RecentExpensesCard>
				<div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
					<div>
						<div className="font-medium">No expenses yet</div>
						<p className="text-muted-foreground text-sm">
							Create your first expense to see it here.
						</p>
					</div>
				</div>
			</RecentExpensesCard>
		);
	}

	return (
		<RecentExpensesCard>
			<div className="max-h-[768px] overflow-y-auto rounded-lg border bg-background/40 p-2 sm:border-0 sm:bg-transparent sm:p-0">
				<Table className="w-full table-fixed">
					<TableHeader>
						<TableRow>
							<TableHead className="w-1/2">Expense</TableHead>
							<TableHead className="w-1/4">Date</TableHead>
							<TableHead className="w-1/4 text-right">Amount</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{recentExpenses.map((expense) => (
							<RecentExpenseRow
								expense={expense}
								formatCurrency={formatCurrency}
								homeCurrency={homeCurrency}
								key={expense.id}
								liveRateToBaseCurrency={liveRateToBaseCurrency}
							/>
						))}
					</TableBody>
				</Table>
			</div>
		</RecentExpensesCard>
	);
}

function RecentExpensesCard({ children }: { children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between">
				<div>
					<CardTitle className="font-semibold text-lg">
						Recent Activity
					</CardTitle>
					<CardDescription>Latest finalized expenses</CardDescription>
				</div>
				<Button asChild size="sm" variant="ghost">
					<Link href="/app/table">View all</Link>
				</Button>
			</CardHeader>
			<CardContent className="px-4 sm:px-6">{children}</CardContent>
		</Card>
	);
}

interface RecentExpenseRowProps {
	expense: NormalizedExpense;
	homeCurrency: string;
	liveRateToBaseCurrency: number | null;
	formatCurrency: (amount: number, currency?: string) => string;
}

const RecentExpenseRow = memo(function RecentExpenseRow({
	expense,
	homeCurrency,
	liveRateToBaseCurrency,
	formatCurrency,
}: RecentExpenseRowProps) {
	const amount = convertExpenseAmountForDisplay(
		expense,
		homeCurrency,
		liveRateToBaseCurrency,
	);

	const showOriginal =
		expense.currency !== homeCurrency && (expense.amountInUSD ?? null) !== null;

	const categoryName = expense.category?.name ?? "Uncategorized";
	const colorKey = expense.category?.color as keyof typeof CATEGORY_COLOR_MAP;
	const categoryColor =
		CATEGORY_COLOR_MAP[colorKey] ?? "bg-muted text-foreground";

	return (
		<TableRow>
			<TableCell>
				<div className="flex min-w-0 items-center gap-3">
					<div
						className={cn(
							"flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full font-semibold text-xs",
							categoryColor,
						)}
					>
						{categoryName.substring(0, 2).toUpperCase()}
					</div>
					<div className="min-w-0 space-y-0.5">
						<div className="truncate font-medium">
							{expense.title || "Untitled expense"}
						</div>
						<div className="truncate text-muted-foreground text-xs">
							{categoryName}
						</div>
					</div>
				</div>
			</TableCell>
			<TableCell className="whitespace-nowrap text-muted-foreground text-sm">
				{format(expense.date, "MMM d")}
			</TableCell>
			<TableCell className="whitespace-nowrap text-right">
				<div className="font-semibold">
					{formatCurrency(amount, homeCurrency)}
				</div>
				{showOriginal && (
					<div className="text-muted-foreground text-xs">
						{formatCurrency(expense.amount, expense.currency)}
					</div>
				)}
			</TableCell>
		</TableRow>
	);
});

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
import { getCategoryIcon } from "~/lib/category-icons";
import type { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { BRAND_ICON_MAP } from "~/lib/icons";
import type { NormalizedExpense } from "~/lib/utils";
import { cn, convertExpenseAmountForDisplay } from "~/lib/utils";

const MUTED_COLOR_MAP: Record<string, string> = {
	emerald: "bg-emerald-500/10 text-emerald-500",
	blue: "bg-blue-500/10 text-blue-500",
	sky: "bg-sky-500/10 text-sky-500",
	cyan: "bg-cyan-500/10 text-cyan-500",
	teal: "bg-teal-500/10 text-teal-500",
	orange: "bg-orange-500/10 text-orange-500",
	amber: "bg-amber-500/10 text-amber-500",
	violet: "bg-violet-500/10 text-violet-500",
	pink: "bg-pink-500/10 text-pink-500",
	fuchsia: "bg-fuchsia-500/10 text-fuchsia-500",
	indigo: "bg-indigo-500/10 text-indigo-500",
	slate: "bg-slate-500/10 text-slate-500",
	zinc: "bg-zinc-500/10 text-zinc-500",
	lime: "bg-lime-500/10 text-lime-500",
	neutral: "bg-neutral-500/10 text-neutral-500",
	gray: "bg-gray-500/10 text-gray-500",
	purple: "bg-purple-500/10 text-purple-500",
	yellow: "bg-yellow-500/10 text-yellow-500",
	stone: "bg-stone-500/10 text-stone-500",
	rose: "bg-rose-500/10 text-rose-500",
	red: "bg-red-500/10 text-red-500",
};

function getExpenseIcon(
	title: string | null,
	categoryName: string,
	categoryIconName?: string | null,
) {
	if (title) {
		const lowerTitle = title.toLowerCase();
		// Check for exact keywords or partial matches
		for (const [keyword, icon] of Object.entries(BRAND_ICON_MAP)) {
			if (lowerTitle.includes(keyword)) {
				return icon;
			}
		}
	}
	// Fallback to category icon using the centralized utility
	return getCategoryIcon(categoryName, categoryIconName);
}

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
			<div className="scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent max-h-[500px] overflow-y-auto rounded-lg border border-border bg-background/40 p-2 sm:border-0 sm:bg-transparent sm:p-0">
				<Table className="w-full table-fixed">
					<TableHeader>
						<TableRow className="border-none hover:bg-transparent">
							<TableHead className="w-1/2 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
								Expense
							</TableHead>
							<TableHead className="w-1/4 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
								Date
							</TableHead>
							<TableHead className="w-1/4 text-right font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
								Amount
							</TableHead>
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
		<Card className="border border-border bg-card shadow-sm">
			<CardHeader className="flex flex-row items-baseline justify-between px-4 sm:px-6">
				<div>
					<CardTitle className="font-semibold text-lg tracking-tight">
						Recent Activity
					</CardTitle>
					<CardDescription>Latest finalized expenses</CardDescription>
				</div>
				<Button asChild size="sm" variant="ghost">
					<Link href="/app/transactions">View all</Link>
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
	const categoryIcon = expense.category?.icon;
	const colorKey = expense.category?.color as keyof typeof CATEGORY_COLOR_MAP;
	const Icon = getExpenseIcon(expense.title, categoryName, categoryIcon);

	return (
		<TableRow className="border-none transition-colors hover:bg-accent/50">
			<TableCell className="py-3">
				<div className="flex min-w-0 items-center gap-3">
					<div
						className={cn(
							"flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
							MUTED_COLOR_MAP[colorKey] ?? "bg-stone-500/10 text-stone-500",
						)}
					>
						<Icon className="h-4 w-4" />
					</div>

					<div className="min-w-0 space-y-0.5">
						<div className="truncate font-medium text-sm">
							{expense.title || "Untitled expense"}
						</div>
						<div className="truncate text-muted-foreground text-xs">
							{categoryName}
						</div>
					</div>
				</div>
			</TableCell>
			<TableCell className="whitespace-nowrap font-medium text-muted-foreground text-xs tabular-nums">
				{format(expense.date, "MMM d")}
			</TableCell>
			<TableCell className="whitespace-nowrap py-3 text-right">
				<div className="font-medium text-foreground text-sm tabular-nums">
					{formatCurrency(amount, homeCurrency)}
				</div>
				{showOriginal && (
					<div className="mt-0.5 font-medium text-[10px] text-muted-foreground tabular-nums">
						{formatCurrency(expense.amount, expense.currency)}
					</div>
				)}
			</TableCell>
		</TableRow>
	);
});

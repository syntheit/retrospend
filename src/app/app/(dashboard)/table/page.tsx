"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { normalizeExpenses } from "~/lib/utils";
import { useCurrency } from "~/hooks/use-currency";
import { api } from "~/trpc/react";

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

const getCurrentYearMonth = () => {
	const date = new Date();
	return { year: date.getFullYear(), month: date.getMonth() };
};

const convertDecimalToNumber = (value: unknown): number => {
	if (typeof value === "object" && value !== null && "toNumber" in value) {
		return (value as { toNumber: () => number }).toNumber();
	}
	return Number(value);
};

const matchesTimeFilter = (
	expenseDate: Date,
	selectedYears: Set<number>,
	selectedMonths: Set<number>,
): boolean => {
	const yearMatch =
		selectedYears.size === 0 || selectedYears.has(expenseDate.getFullYear());
	const monthMatch =
		selectedMonths.size === 0 || selectedMonths.has(expenseDate.getMonth());
	return yearMatch && monthMatch;
};

export default function Page() {
	const { openNewExpense } = useExpenseModal();
	const {
		data: expenses,
		isLoading,
		error,
		refetch: refetchExpenses,
	} = api.expense.listFinalized.useQuery();
	const {
		homeCurrency,
		usdToHomeRate: liveRateToBaseCurrency,
		isLoading: currencyLoading,
	} = useCurrency();
	const { data: settings } = api.user.getSettings.useQuery();

	const normalizedExpenses = useMemo(
		() =>
			normalizeExpenses(
				(expenses ?? []).map((expense) => ({
					...expense,
					amount: convertDecimalToNumber(expense.amount),
					exchangeRate: convertDecimalToNumber(expense.exchangeRate),
					amountInUSD: convertDecimalToNumber(expense.amountInUSD),
				})),
			),
		[expenses],
	);

	const availableYears = useMemo(() => {
		const years = new Set<number>();
		normalizedExpenses.forEach((expense) => {
			years.add(expense.date.getFullYear());
		});
		return Array.from(years).sort((a, b) => b - a);
	}, [normalizedExpenses]);

	const availableMonths = useMemo(() => {
		const months = new Set<number>();
		normalizedExpenses.forEach((expense) => {
			months.add(expense.date.getMonth());
		});
		return Array.from(months).sort((a, b) => a - b);
	}, [normalizedExpenses]);

	const { year: currentYear, month: currentMonth } = getCurrentYearMonth();

	const [selectedYears, setSelectedYears] = useState<Set<number>>(
		() => new Set([currentYear]),
	);
	const [selectedMonths, setSelectedMonths] = useState<Set<number>>(
		() => new Set([currentMonth]),
	);
	const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
		() => new Set(),
	);
	const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	const deleteExpenseMutation = api.expense.deleteExpense.useMutation();

	const availableCategories = useMemo(() => {
		const categoryMap = new Map<
			string,
			{ id: string; name: string; color: string; usageCount: number }
		>();

		const timeFilteredExpenses = normalizedExpenses.filter((expense) =>
			matchesTimeFilter(expense.date, selectedYears, selectedMonths),
		);

		timeFilteredExpenses.forEach((expense) => {
			if (expense.category) {
				const existing = categoryMap.get(expense.category.id);
				if (existing) {
					existing.usageCount++;
				} else {
					categoryMap.set(expense.category.id, {
						...expense.category,
						usageCount: 1,
					});
				}
			}
		});

		return Array.from(categoryMap.values()).sort(
			(a, b) => b.usageCount - a.usageCount,
		);
	}, [normalizedExpenses, selectedYears, selectedMonths]);

	const filteredExpenses = useMemo(() => {
		if (
			selectedYears.size === 0 &&
			selectedMonths.size === 0 &&
			selectedCategories.size === 0
		) {
			return normalizedExpenses;
		}

		return normalizedExpenses.filter((expense) => {
			const timeMatch = matchesTimeFilter(
				expense.date,
				selectedYears,
				selectedMonths,
			);
			const categoryMatch =
				selectedCategories.size === 0 ||
				(expense.categoryId && selectedCategories.has(expense.categoryId));
			return timeMatch && categoryMatch;
		});
	}, [normalizedExpenses, selectedYears, selectedMonths, selectedCategories]);

	if (isLoading) {
		return (
			<>
				<SiteHeader title="Expenses" />
				<PageContent>
					<div className="flex h-64 items-center justify-center">
						<div className="text-muted-foreground">Loading expenses...</div>
					</div>
				</PageContent>
			</>
		);
	}

	if (error) {
		return (
			<>
				<SiteHeader title="Expenses" />
				<PageContent>
					<div className="flex h-64 items-center justify-center">
						<div className="text-destructive">Error loading expenses</div>
					</div>
				</PageContent>
			</>
		);
	}

	const toggleYear = (year: number) => {
		setSelectedYears((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(year)) {
				newSet.delete(year);
			} else {
				newSet.add(year);
			}
			return newSet;
		});
	};

	const toggleMonth = (month: number) => {
		setSelectedMonths((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(month)) {
				newSet.delete(month);
			} else {
				newSet.add(month);
			}
			return newSet;
		});
	};

	const toggleCategory = (categoryId: string) => {
		setSelectedCategories((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(categoryId)) {
				newSet.delete(categoryId);
			} else {
				newSet.add(categoryId);
			}
			return newSet;
		});
	};

	const clearFilters = () => {
		setSelectedYears(new Set());
		setSelectedMonths(new Set());
		setSelectedCategories(new Set());
	};

	const handleCreateExpense = () => {
		toast.dismiss();
		toast.info("Starting a new expense draft");
		openNewExpense();
	};

	const handleDeleteSelected = () => {
		setShowDeleteDialog(true);
	};

	const confirmDelete = async () => {
		try {
			await Promise.all(
				Array.from(selectedExpenseIds).map((id) =>
					deleteExpenseMutation.mutateAsync({ id }),
				),
			);

			setSelectedExpenseIds(new Set());
			setShowDeleteDialog(false);
			await refetchExpenses();
			toast.success("Expenses deleted successfully");
		} catch (_error) {
			toast.error("Failed to delete some expenses. Please try again.");
		}
	};

	return (
		<>
			<SiteHeader title="Table View" />
			<PageContent>
				<div className="space-y-6">
					<div className="w-full space-y-4">
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<h3 className="font-medium text-sm">Filter by Year</h3>
								<Button
									className="h-6 px-2 text-xs"
									disabled={selectedYears.size === 0}
									onClick={() => setSelectedYears(new Set())}
									size="sm"
									variant="ghost"
								>
									Clear years
								</Button>
							</div>
							<div className="flex flex-wrap gap-2">
								{availableYears.map((year) => (
									<Button
										aria-pressed={selectedYears.has(year)}
										className="h-8 min-w-[60px]"
										key={year}
										onClick={() => toggleYear(year)}
										size="sm"
										variant={selectedYears.has(year) ? "default" : "outline"}
									>
										{year}
									</Button>
								))}
							</div>
						</div>

						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<h3 className="font-medium text-sm">Filter by Month</h3>
								<Button
									className="h-6 px-2 text-xs"
									disabled={selectedMonths.size === 0}
									onClick={() => setSelectedMonths(new Set())}
									size="sm"
									variant="ghost"
								>
									Clear months
								</Button>
							</div>
							<div className="flex flex-wrap gap-2">
								{availableMonths.map((month) => (
									<Button
										aria-pressed={selectedMonths.has(month)}
										className="h-8 min-w-[80px]"
										key={month}
										onClick={() => toggleMonth(month)}
										size="sm"
										variant={selectedMonths.has(month) ? "default" : "outline"}
									>
										{MONTH_NAMES[month]}
									</Button>
								))}
							</div>
						</div>

						{availableCategories.length > 0 && (
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<h3 className="font-medium text-sm">Filter by Category</h3>
									<Button
										className="h-6 px-2 text-xs"
										disabled={selectedCategories.size === 0}
										onClick={() => setSelectedCategories(new Set())}
										size="sm"
										variant="ghost"
									>
										Clear categories
									</Button>
								</div>
								<div className="flex flex-wrap gap-2">
									{availableCategories.map((category) => (
										<Button
											aria-pressed={selectedCategories.has(category.id)}
											className="flex h-8 min-w-[100px] items-center gap-2"
											key={category.id}
											onClick={() => toggleCategory(category.id)}
											size="sm"
											variant={
												selectedCategories.has(category.id)
													? "default"
													: "outline"
											}
										>
											<div
												className={`h-3 w-3 rounded-full ${
													CATEGORY_COLOR_MAP[
														category.color as keyof typeof CATEGORY_COLOR_MAP
													]?.split(" ")[0] || "bg-gray-400"
												}`}
											/>
											{category.name}
										</Button>
									))}
								</div>
							</div>
						)}
					</div>

					<DataTable
						data={filteredExpenses}
						emptyState={
							<div className="space-y-3 py-6 text-center">
								<p className="text-muted-foreground">
									{normalizedExpenses.length === 0
										? "No expenses yet."
										: "No expenses match your filters."}
								</p>
								<div className="flex flex-wrap justify-center gap-2">
									<Button onClick={handleCreateExpense}>Add expense</Button>
									<Button onClick={clearFilters} variant="outline">
										Reset filters
									</Button>
									<Button asChild variant="ghost">
										<Link href="/app/analytics">View analytics</Link>
									</Button>
								</div>
							</div>
						}
						homeCurrency={settings?.homeCurrency || "USD"}
						liveRateToBaseCurrency={liveRateToBaseCurrency}
						onDeleteSelected={handleDeleteSelected}
						onSelectionChange={setSelectedExpenseIds}
						selectedRows={selectedExpenseIds}
					/>
				</div>
			</PageContent>

			<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Expenses</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete {selectedExpenseIds.size} expense
							{selectedExpenseIds.size !== 1 ? "s" : ""}? This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteExpenseMutation.isPending}
							onClick={() => setShowDeleteDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteExpenseMutation.isPending}
							onClick={confirmDelete}
							variant="destructive"
						>
							{deleteExpenseMutation.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

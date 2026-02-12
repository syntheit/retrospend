"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { createExpenseColumns } from "~/components/data-table-columns";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
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
import { TableCell, TableRow } from "~/components/ui/table";
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { convertExpenseAmountForDisplay, normalizeExpenses } from "~/lib/utils";
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
	const { openNewExpense, openExpense } = useExpenseModal();
	const { formatCurrency } = useCurrencyFormatter();
	const {
		data: expenses,
		isLoading,
		error,
		refetch: refetchExpenses,
	} = api.expense.listFinalized.useQuery();
	const { usdToHomeRate: liveRateToBaseCurrency } = useCurrency();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const exportMutation = api.expense.exportCsv.useMutation();

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

	// Selection Handlers
	const handleRowSelect = useCallback((id: string, checked: boolean) => {
		setSelectedExpenseIds((prev) => {
			const newSet = new Set(prev);
			if (checked) {
				newSet.add(id);
			} else {
				newSet.delete(id);
			}
			return newSet;
		});
	}, []);

	const handleSelectAll = useCallback(
		(checked: boolean) => {
			if (checked) {
				setSelectedExpenseIds(new Set(filteredExpenses.map((e) => e.id)));
			} else {
				setSelectedExpenseIds(new Set());
			}
		},
		[filteredExpenses],
	);

	const handleExportSelected = async () => {
		try {
			const expenseIds = Array.from(selectedExpenseIds);
			const { csv } = await exportMutation.mutateAsync({
				expenseIds,
			});
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `expenses-selected-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success("Selected expenses exported");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to export selected expenses",
			);
		}
	};

	// Cleanup selection if items are filtered out
	useEffect(() => {
		if (selectedExpenseIds.size === 0) return;
		const visibleIds = new Set(filteredExpenses.map((e) => e.id));
		const newSelected = new Set<string>();
		let hasChanges = false;
		for (const id of selectedExpenseIds) {
			if (visibleIds.has(id)) {
				newSelected.add(id);
			} else {
				hasChanges = true;
			}
		}
		if (hasChanges) {
			setSelectedExpenseIds(newSelected);
		}
	}, [filteredExpenses, selectedExpenseIds]);

	const homeCurrency = settings?.homeCurrency || "USD";
	const hasForeignCurrencyExpenses = filteredExpenses.some(
		(e) => e.currency !== "USD" && e.exchangeRate && e.amountInUSD,
	);

	const columns = useMemo(
		() =>
			createExpenseColumns(
				homeCurrency,
				liveRateToBaseCurrency ?? null,
				hasForeignCurrencyExpenses,
				selectedExpenseIds,
				handleRowSelect,
				handleSelectAll,
				formatCurrency,
			),
		[
			homeCurrency,
			liveRateToBaseCurrency,
			hasForeignCurrencyExpenses,
			selectedExpenseIds,
			handleRowSelect,
			handleSelectAll,
			formatCurrency,
		],
	);

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
						{/* Filters ... */}
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
						columns={columns}
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
						footer={
							<TableRow className="border-t-2 bg-muted/50 font-semibold">
								<TableCell
									className="px-4 py-3 text-left font-semibold"
									colSpan={4}
								>
									Total ({filteredExpenses.length} items)
								</TableCell>
								{hasForeignCurrencyExpenses && (
									<TableCell className="px-4 py-3 text-right font-semibold">
										{/* This logic would ideally be moved to a util since we calculate it based on currently visible rows */}
										Total Local...
									</TableCell>
								)}
								<TableCell className="px-4 py-3 text-right font-semibold">
									<div className="text-right font-medium">
										{formatCurrency(
											filteredExpenses.reduce(
												(acc, curr) =>
													acc +
													convertExpenseAmountForDisplay(
														curr,
														homeCurrency,
														liveRateToBaseCurrency ?? null,
													),
												0,
											),
											homeCurrency,
										)}
									</div>
								</TableCell>
							</TableRow>
						}
						initialSorting={[{ id: "date", desc: true }]}
						onRowClick={(row) => openExpense(row.id)}
						renderToolbar={(table, headerHeight) => (
							<DataTableSelectionBar
								exportMutation={exportMutation}
								headerHeight={headerHeight}
								onDeleteSelected={handleDeleteSelected}
								onEditSelected={(id) => {
									openExpense(id);
									setSelectedExpenseIds(new Set());
								}}
								onExportSelected={handleExportSelected}
								onSelectAll={handleSelectAll}
								selectedRows={selectedExpenseIds}
							/>
						)}
						searchPlaceholder="Search expenses..."
					/>
				</div>
			</PageContent>

			{/* Deletion Dialog ... */}
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

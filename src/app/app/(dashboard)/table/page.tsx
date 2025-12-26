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
import { api } from "~/trpc/react";

export default function Page() {
	const { openNewExpense } = useExpenseModal();
	const {
		data: expenses,
		isLoading,
		error,
		refetch: refetchExpenses,
	} = api.expense.listFinalized.useQuery();
	const { data: settings } = api.user.getSettings.useQuery();

	const normalizedExpenses = useMemo(
		() =>
			normalizeExpenses(
				(expenses ?? []).map((expense) => ({
					...expense,
					amount: typeof expense.amount?.toNumber === "function" ? expense.amount.toNumber() : Number(expense.amount),
					exchangeRate:
						typeof expense.exchangeRate?.toNumber === "function"
							? expense.exchangeRate.toNumber()
							: Number(expense.exchangeRate),
					amountInUSD:
						typeof expense.amountInUSD?.toNumber === "function"
							? expense.amountInUSD.toNumber()
							: Number(expense.amountInUSD),
				})),
			),
		[expenses],
	);

	// Extract available years and months from the data
	const availableYears = useMemo(() => {
		const years = new Set<number>();
		normalizedExpenses.forEach((expense) => {
			years.add(expense.date.getFullYear());
		});
		return Array.from(years).sort((a, b) => b - a); // Most recent first
	}, [normalizedExpenses]);

	const availableMonths = useMemo(() => {
		const months = new Set<number>();
		normalizedExpenses.forEach((expense) => {
			months.add(expense.date.getMonth());
		});
		return Array.from(months).sort((a, b) => a - b);
	}, [normalizedExpenses]);

	// Filter state - default to current year and month
	const currentDate = new Date();
	const currentYear = currentDate.getFullYear();
	const currentMonth = currentDate.getMonth();

	const [selectedYears, setSelectedYears] = useState<Set<number>>(
		new Set([currentYear]),
	);
	const [selectedMonths, setSelectedMonths] = useState<Set<number>>(
		new Set([currentMonth]),
	);
	const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
		new Set(),
	);

	// Selection state for table rows
	const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(
		new Set(),
	);

	// Delete confirmation dialog state
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	// Delete mutation
	const deleteExpenseMutation = api.expense.deleteExpense.useMutation();

	const availableCategories = useMemo(() => {
		const categoryMap = new Map<
			string,
			{ id: string; name: string; color: string }
		>();

		// Filter expenses based on selected years and months (ignoring category filter)
		const timeFilteredExpenses = normalizedExpenses.filter((expense) => {
			const yearMatch =
				selectedYears.size === 0 ||
				selectedYears.has(expense.date.getFullYear());
			const monthMatch =
				selectedMonths.size === 0 ||
				selectedMonths.has(expense.date.getMonth());
			return yearMatch && monthMatch;
		});

		// Collect categories only from expenses in the selected time period
		timeFilteredExpenses.forEach((expense) => {
			if (expense.category) {
				categoryMap.set(expense.category.id, expense.category);
			}
		});

		return Array.from(categoryMap.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	}, [normalizedExpenses, selectedYears, selectedMonths]);

	// Filter expenses based on selections
	const filteredExpenses = useMemo(() => {
		if (
			selectedYears.size === 0 &&
			selectedMonths.size === 0 &&
			selectedCategories.size === 0
		) {
			return normalizedExpenses;
		}

		return normalizedExpenses.filter((expense) => {
			const yearMatch =
				selectedYears.size === 0 ||
				selectedYears.has(expense.date.getFullYear());
			const monthMatch =
				selectedMonths.size === 0 ||
				selectedMonths.has(expense.date.getMonth());
			const categoryMatch =
				selectedCategories.size === 0 ||
				(expense.categoryId && selectedCategories.has(expense.categoryId));
			return yearMatch && monthMatch && categoryMatch;
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

	const monthNames = [
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
	];

	const toggleYear = (year: number) => {
		const newSelected = new Set(selectedYears);
		if (newSelected.has(year)) {
			newSelected.delete(year);
		} else {
			newSelected.add(year);
		}
		setSelectedYears(newSelected);
	};

	const toggleMonth = (month: number) => {
		const newSelected = new Set(selectedMonths);
		if (newSelected.has(month)) {
			newSelected.delete(month);
		} else {
			newSelected.add(month);
		}
		setSelectedMonths(newSelected);
	};

	const toggleCategory = (categoryId: string) => {
		const newSelected = new Set(selectedCategories);
		if (newSelected.has(categoryId)) {
			newSelected.delete(categoryId);
		} else {
			newSelected.add(categoryId);
		}
		setSelectedCategories(newSelected);
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

	// Delete handlers
	const handleDeleteSelected = () => {
		setShowDeleteDialog(true);
	};

	const confirmDelete = async () => {
		try {
			// Delete all selected expenses
			await Promise.all(
				Array.from(selectedExpenseIds).map((id) =>
					deleteExpenseMutation.mutateAsync({ id }),
				),
			);

			// Clear selection and close dialog
			setSelectedExpenseIds(new Set());
			setShowDeleteDialog(false);

			// Refetch data
			await refetchExpenses();
			toast.success("Expenses deleted successfully");  // Add success toast
		} catch (error) {
			toast.error("Failed to delete some expenses. Please try again.");  // Add error toast
		}
	};

	return (
		<>
			<SiteHeader title="Table View" />
			<PageContent>
				{/* Main container with consistent padding */}
				<div className="space-y-6">
					{/* Date Filters */}
					<div className="w-full space-y-4">
						{/* Years */}
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

						{/* Months */}
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
										{monthNames[month]}
									</Button>
								))}
							</div>
						</div>

						{/* Categories */}
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
						onDeleteSelected={handleDeleteSelected}
						onSelectionChange={setSelectedExpenseIds}
						selectedRows={selectedExpenseIds}
					/>
				</div>
			</PageContent>

			{/* Delete Confirmation Dialog */}
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

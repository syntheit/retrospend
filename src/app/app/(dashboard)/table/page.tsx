"use client";

import Link from "next/link";
import { useMemo } from "react";
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
import { useTableActions } from "~/hooks/use-table-actions";
import { useTableFilters } from "~/hooks/use-table-filters";
import { convertExpenseAmountForDisplay, normalizeExpenses } from "~/lib/utils";
import { api } from "~/trpc/react";
import { TableFilters } from "./_components/table-filters";
import { TableToolbar } from "./_components/table-toolbar";

const convertDecimalToNumber = (value: unknown): number => {
	if (typeof value === "object" && value !== null && "toNumber" in value) {
		return (value as { toNumber: () => number }).toNumber();
	}
	return Number(value);
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

	// Filter Logic Hook
	const {
		selectedYears,
		selectedMonths,
		selectedCategories,
		availableYears,
		availableMonths,
		availableCategories,
		filteredExpenses,
		toggleYear,
		toggleMonth,
		toggleCategory,
		clearFilters,
		clearYears,
		clearMonths,
		clearCategories,
	} = useTableFilters(normalizedExpenses);

	// Action Logic Hook
	const {
		selectedIds: selectedExpenseIds,
		showDeleteDialog,
		isDeleting,
		isExporting,
		setShowDeleteDialog,
		setSelectedIds: setSelectedExpenseIds,
		handleRowSelect,
		handleSelectAll,
		handleExportSelected,
		handleDeleteSelected,
		confirmDelete,
	} = useTableActions(filteredExpenses, refetchExpenses);

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

	const handleCreateExpense = () => {
		toast.dismiss();
		toast.info("Starting a new expense draft");
		openNewExpense();
	};

	return (
		<>
			<SiteHeader
				actions={<TableToolbar onCreateExpense={handleCreateExpense} />}
				title="Table View"
			/>
			<PageContent>
				<div className="space-y-6">
					<div className="w-full space-y-4">
						<TableFilters
							availableCategories={availableCategories}
							availableMonths={availableMonths}
							availableYears={availableYears}
							clearCategories={clearCategories}
							clearMonths={clearMonths}
							clearYears={clearYears}
							selectedCategories={selectedCategories}
							selectedMonths={selectedMonths}
							selectedYears={selectedYears}
							toggleCategory={toggleCategory}
							toggleMonth={toggleMonth}
							toggleYear={toggleYear}
						/>
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
								exportMutation={{ isPending: isExporting }}
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

			{/* Deletion Dialog */}
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
							disabled={isDeleting}
							onClick={() => setShowDeleteDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={isDeleting}
							onClick={confirmDelete}
							variant="destructive"
						>
							{isDeleting ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

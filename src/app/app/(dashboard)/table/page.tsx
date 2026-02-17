"use client";

// import Link from "next/link";
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
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useExpensesController } from "~/hooks/use-expenses-controller";
import { useTableActions } from "~/hooks/use-table-actions";
import { ExpensesTableFooter } from "./_components/expenses-table-footer";
import { TableFilters } from "./_components/table-filters";

export default function Page() {
	const { openNewExpense, openExpense } = useExpenseModal();
	const { formatCurrency } = useCurrencyFormatter();

	const {
		expenses: filteredExpenses,
		totals,
		filters,
		homeCurrency,
		liveRateToBaseCurrency,
		isLoading,
		isError,
		refetch,
	} = useExpensesController();

	const {
		selectedYears,
		selectedMonths,
		selectedCategories,
		availableYears,
		availableMonths,
		availableCategories,
		toggleYear,
		toggleMonth,
		toggleCategory,
		clearFilters,
		clearYears,
		clearMonths,
		clearCategories,
	} = filters;

	// Action Logic Hook remains as it depends on filteredExpenses and refetch
	// (Note: we could also move this into the controller for further decoupling)
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
	} = useTableActions(filteredExpenses, refetch);

	const columns = useMemo(
		() =>
			createExpenseColumns(
				homeCurrency,
				liveRateToBaseCurrency ?? null,
				totals.hasForeignCurrencyExpenses,
				selectedExpenseIds,
				handleRowSelect,
				handleSelectAll,
				formatCurrency,
			),
		[
			homeCurrency,
			liveRateToBaseCurrency,
			totals.hasForeignCurrencyExpenses,
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

	if (isError) {
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
			<SiteHeader title="Table View" />
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
									{filteredExpenses.length === 0 && !isLoading
										? "No expenses yet."
										: "No expenses match your filters."}
								</p>
								<div className="flex flex-wrap justify-center gap-2">
									<Button onClick={handleCreateExpense}>Add expense</Button>
									<Button onClick={clearFilters} variant="outline">
										Reset filters
									</Button>
									{/* <Button asChild variant="ghost">
	<Link href="/app/analytics">View analytics</Link>
</Button> */}
								</div>
							</div>
						}
						footer={
							<ExpensesTableFooter
								count={totals.count}
								currency={homeCurrency}
								hasForeignCurrencyExpenses={totals.hasForeignCurrencyExpenses}
								totalAmount={totals.totalAmount}
							/>
						}
						initialSorting={[{ id: "date", desc: true }]}
						renderToolbar={(_table, headerHeight) => (
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

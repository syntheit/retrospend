"use client";

import {
	Copy,
	Download,
	Edit2,
	Receipt,
	Search,
	Tags,
	Trash2,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createElement, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { createExpenseColumns } from "~/components/data-table-columns";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import {
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "~/components/ui/context-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useExpensesController } from "~/hooks/use-expenses-controller";
import { useIsMobile } from "~/hooks/use-mobile";
import { useTableActions } from "~/hooks/use-table-actions";
import { getCategoryIcon } from "~/lib/category-icons";
import { getCategoryColorClasses } from "~/lib/constants";
import { cn, convertExpenseAmountForDisplay } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ExpensesTableFooter } from "./_components/expenses-table-footer";
import { FilterBar } from "./_components/filter-bar";

function TransactionsContent() {
	const { openNewExpense, openExpense, openSharedExpense, openDuplicateExpense } =
		useExpenseModal();
	const { formatCurrency } = useCurrencyFormatter();
	const isMobile = useIsMobile();

	// On mobile, hide less important columns to reduce horizontal scroll
	const columnVisibility: import("@tanstack/react-table").VisibilityState =
		isMobile ? { category: false, localPrice: false } : {};

	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	// Read initial filter state from URL (only on mount)
	const [initialFilterState] = useState(() => {
		const y = searchParams
			.get("y")
			?.split(",")
			.map(Number)
			.filter((n) => !isNaN(n));
		const m = searchParams
			.get("m")
			?.split(",")
			.map(Number)
			.filter((n) => !isNaN(n));
		const cat = searchParams.get("cat")?.split(",").filter(Boolean);
		const from = searchParams.get("from");
		const to = searchParams.get("to");
		const preset = searchParams.get("range");
		const min = searchParams.get("min");
		const max = searchParams.get("max");

		return {
			initialYears: y?.length ? y : undefined,
			initialMonths: m?.length ? m : undefined,
			initialCategories: cat?.length ? cat : undefined,
			initialDateRange:
				from && to
					? {
							from: new Date(from + "T00:00:00"),
							to: new Date(to + "T23:59:59.999"),
							preset: preset ?? undefined,
						}
					: undefined,
			initialAmountRange:
				min || max
					? {
							min: min ? Number(min) : undefined,
							max: max ? Number(max) : undefined,
						}
					: undefined,
		};
	});

	const [searchQuery, setSearchQuery] = useState("");
	const [displayedCount, setDisplayedCount] = useState(0);
	const [categorySearch, setCategorySearch] = useState("");

	const {
		expenses: filteredExpenses,
		totals,
		filters,
		homeCurrency,
		liveRateToBaseCurrency,
		isLoading,
		isError,
		refetch,
		typeFilter,
		setTypeFilter,
		excludeFilter,
		setExcludeFilter,
		hasSharedExpenses,
	} = useExpensesController(initialFilterState);

	const {
		selectedYears,
		selectedMonths,
		selectedCategories,
		dateRange,
		amountRange,
		availableYears,
		availableMonths,
		availableCategories,
		toggleYear,
		toggleMonth,
		toggleCategory,
		setDateRange,
		setAmountRange,
		clearFilters,
		clearYears,
		clearMonths,
		clearCategories,
		clearDateRange,
		clearAmountRange,
	} = filters;

	// Sync filter state to URL params (replace, not push)
	const isFirstRender = useRef(true);
	useEffect(() => {
		// Skip the first render to avoid overwriting URL params on mount
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		const params = new URLSearchParams();
		if (!dateRange) {
			if (selectedYears.size > 0) params.set("y", [...selectedYears].join(","));
			if (selectedMonths.size > 0)
				params.set("m", [...selectedMonths].join(","));
		} else {
			params.set("from", dateRange.from.toISOString().split("T")[0]!);
			params.set("to", dateRange.to.toISOString().split("T")[0]!);
			if (dateRange.preset) params.set("range", dateRange.preset);
		}
		if (selectedCategories.size > 0)
			params.set("cat", [...selectedCategories].join(","));
		if (amountRange.min != null) params.set("min", String(amountRange.min));
		if (amountRange.max != null) params.set("max", String(amountRange.max));

		const queryString = params.toString();
		const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
		router.replace(newUrl, { scroll: false });
	}, [
		selectedYears,
		selectedMonths,
		selectedCategories,
		dateRange,
		amountRange,
		router,
		pathname,
	]);

	// Action Logic Hook
	const {
		selectedIds: selectedExpenseIds,
		showDeleteDialog,
		isDeleting,
		isExporting,
		setShowDeleteDialog,
		setSelectedIds: setSelectedExpenseIds,
		lastSelectedId,
		handleRowSelect,
		handleSelectAll,
		handleRangeSelect,
		handleExportSelected,
		handleDeleteSelected,
		confirmDelete,
	} = useTableActions(filteredExpenses, refetch);

	// Bulk recategorize mutation
	const bulkRecategorizeMutation = api.expense.bulkUpdateCategory.useMutation();
	const utils = api.useUtils();
	const { data: allCategories } = api.categories.getAll.useQuery();

	// Shared transaction delete
	const [pendingSharedDelete, setPendingSharedDelete] = useState<string | null>(null);
	const deleteSharedTxMutation = api.sharedTransaction.delete.useMutation({
		onSuccess: () => {
			toast.success("Shared expense deleted");
			setPendingSharedDelete(null);
			void utils.expense.listSharedParticipations.invalidate();
			void utils.dashboard.getOverviewStats.invalidate();
			void utils.dashboard.getRecentActivity.invalidate();
			void utils.stats.invalidate();
			void utils.budget.getBudgets.invalidate();
		},
		onError: () => {
			toast.error("Failed to delete shared expense");
		},
	});

	const handleRecategorize = async (categoryId: string) => {
		const ids = Array.from(selectedExpenseIds);
		if (ids.length === 0) return;
		try {
			const result = await bulkRecategorizeMutation.mutateAsync({
				expenseIds: ids,
				categoryId,
			});
			handleSelectAll(false);
			await Promise.all([
				utils.expense.listFinalized.invalidate(),
				utils.expense.getFilterOptions.invalidate(),
			]);
			toast.success(
				`Updated ${result.count} expense${result.count !== 1 ? "s" : ""} to ${result.categoryName}`,
			);
		} catch {
			toast.error("Failed to update categories");
		}
	};

	const handleDuplicate = (id: string) => {
		const expense = filteredExpenses.find((e) => e.id === id);
		if (!expense) return;
		openDuplicateExpense({
			title: expense.title,
			amount: expense.amount,
			currency: expense.currency,
			exchangeRate: expense.exchangeRate,
			amountInUSD: expense.amountInUSD,
			pricingSource: expense.pricingSource,
			categoryId: expense.categoryId,
			description: expense.description,
			location: expense.location,
		});
		setSelectedExpenseIds(new Set());
	};

	const columns = useMemo(
		() =>
			createExpenseColumns(
				homeCurrency,
				liveRateToBaseCurrency ?? null,
				totals.hasForeignCurrencyExpenses,
				formatCurrency,
				(id) => {
					openExpense(id);
					setSelectedExpenseIds(new Set());
				},
				(id) => {
					setSelectedExpenseIds(new Set([id]));
					setShowDeleteDialog(true);
				},
				typeFilter,
				(sharedTxId) => {
					openSharedExpense(sharedTxId);
					setSelectedExpenseIds(new Set());
				},
				(sharedTxId) => {
					setPendingSharedDelete(sharedTxId);
				},
				handleDuplicate,
				hasSharedExpenses,
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			homeCurrency,
			liveRateToBaseCurrency,
			totals.hasForeignCurrencyExpenses,
			formatCurrency,
			openExpense,
			openSharedExpense,
			setSelectedExpenseIds,
			setShowDeleteDialog,
			typeFilter,
			hasSharedExpenses,
			filteredExpenses,
		],
	);

	const filterBarProps = {
		typeFilter,
		setTypeFilter,
		excludeFilter,
		hasSharedExpenses,
		setExcludeFilter,
		selectedYears,
		selectedMonths,
		selectedCategories,
		availableYears,
		availableMonths,
		availableCategories,
		toggleYear,
		toggleMonth,
		toggleCategory,
		clearYears,
		clearMonths,
		clearCategories,
		dateRange,
		setDateRange,
		clearDateRange,
		amountRange,
		setAmountRange,
		clearAmountRange,
		clearFilters,
		homeCurrency,
		searchQuery,
		onSearchChange: setSearchQuery,
		searchPlaceholder: "Search expenses...",
		displayedCount,
	};

	if (isLoading) {
		return (
			<>
				<SiteHeader title="Transactions" />
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
				<SiteHeader title="Transactions" />
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
			<SiteHeader title="Transactions" />
			<PageContent fill>
				<div className="flex min-h-0 flex-1 flex-col gap-4">
					<FilterBar {...filterBarProps} />

					<DataTable
						columns={columns}
						columnVisibility={columnVisibility}
						countNoun="expenses"
						data={filteredExpenses}
						searchValue={searchQuery}
						onSearchChange={setSearchQuery}
						onFilteredCountChange={setDisplayedCount}
						onDeleteSelected={handleDeleteSelected}
						onEditRow={(id) => {
							const expense = filteredExpenses.find((e) => e.id === id);
							if (expense?.source === "shared" && expense.sharedContext?.transactionId) {
								openSharedExpense(expense.sharedContext.transactionId);
							} else {
								openExpense(id);
							}
							setSelectedExpenseIds(new Set());
						}}
						emptyState={
							<EmptyState
								action={
									typeFilter !== "shared"
										? { label: "Add Expense", onClick: handleCreateExpense }
										: undefined
								}
								description={
									typeFilter === "shared"
										? "No shared expenses yet. Share an expense from a project to see it here."
										: filteredExpenses.length === 0 && !isLoading
											? "Add your first expense to start tracking your spending."
											: "No expenses match your current filters."
								}
								icon={Receipt}
								secondaryAction={{
									label: "Reset Filters",
									onClick: clearFilters,
									variant: "outline",
								}}
								title={
									typeFilter === "shared"
										? "No Shared Expenses"
										: filteredExpenses.length === 0 && !isLoading
											? "No Expenses Yet"
											: "No Results"
								}
							/>
						}
						fillHeight
						footer={(rows) => {
							const displayTotal = rows.reduce(
								(acc, row) =>
									acc +
									convertExpenseAmountForDisplay(
										row,
										homeCurrency,
										liveRateToBaseCurrency ?? null,
									),
								0,
							);
							const excludedRows = rows.filter((r) => r.excludeFromAnalytics);
							const excludedAmount = excludedRows.reduce(
								(acc, row) =>
									acc +
									convertExpenseAmountForDisplay(
										row,
										homeCurrency,
										liveRateToBaseCurrency ?? null,
									),
								0,
							);
							return (
								<ExpensesTableFooter
									count={rows.length}
									currency={homeCurrency}
									excludedAmount={
										excludedRows.length > 0 ? excludedAmount : undefined
									}
									hasForeignCurrencyExpenses={rows.some(
										(r) => r.currency !== "USD",
									)}
									hasPaidByColumn={hasSharedExpenses && typeFilter !== "personal"}
									totalAmount={displayTotal}
								/>
							);
						}}
						initialSorting={[{ id: "date", desc: true }]}
						lastSelectedId={lastSelectedId}
						onClearSelection={() => handleSelectAll(false)}
						onRangeSelect={handleRangeSelect}
						onRowSelect={handleRowSelect}
						progressive
						renderContextMenu={(row) => {
							if (row.source === "shared") {
								const sharedCtx = row.sharedContext;
								const sharedTxId = sharedCtx?.transactionId;
								if (!sharedTxId) return null;
								const canEdit = !!sharedCtx?.canEdit;
								const canDelete = !!sharedCtx?.canDelete;
								if (!canEdit && !canDelete) return null;
								return (
									<>
										{canEdit && (
											<ContextMenuItem
												onClick={() => {
													openSharedExpense(sharedTxId);
													setSelectedExpenseIds(new Set());
												}}
											>
												<Edit2 className="mr-2 h-4 w-4" />
												Edit expense
											</ContextMenuItem>
										)}
										{canDelete && (
											<>
												{canEdit && <ContextMenuSeparator />}
												<ContextMenuItem
													onClick={() => setPendingSharedDelete(sharedTxId)}
													variant="destructive"
												>
													<Trash2 className="mr-2 h-4 w-4" />
													Delete expense
												</ContextMenuItem>
											</>
										)}
									</>
								);
							}

							const isInSelection = selectedExpenseIds.has(row.id);
							const selectionCount = selectedExpenseIds.size;
							const isMultiSelected = isInSelection && selectionCount > 1;

							if (isMultiSelected) {
								return (
									<>
										<ContextMenuItem
											onClick={() => void handleExportSelected()}
										>
											<Download className="mr-2 h-4 w-4" />
											Export {selectionCount} selected
										</ContextMenuItem>
										{allCategories && allCategories.length > 0 && (
											<ContextMenuSub onOpenChange={(open) => { if (!open) setCategorySearch(""); }}>
												<ContextMenuSubTrigger className="gap-2">
													<Tags className="size-4" />
													Recategorize {selectionCount} selected
												</ContextMenuSubTrigger>
												<ContextMenuSubContent className="w-56 p-0">
													<div className="flex items-center gap-2 border-b px-3 py-2">
														<Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
														<input
															className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
															placeholder="Search categories..."
															value={categorySearch}
															onChange={(e) => setCategorySearch(e.target.value)}
														/>
													</div>
													<div className="max-h-52 overflow-y-auto overscroll-contain py-1">
														{allCategories
															.filter((c) =>
																c.name.toLowerCase().includes(categorySearch.toLowerCase()),
															)
															.map((category) => (
																<Button
																	key={category.id}
																	type="button"
																	className="flex h-auto w-full items-center justify-start gap-2.5 rounded-none px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
																	onClick={() => void handleRecategorize(category.id)}
																	variant="ghost"
																>
																	<span
																		className={cn(
																			"flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
																			getCategoryColorClasses(category.color, "accent"),
																		)}
																	>
																		{createElement(
																			getCategoryIcon(category.name, category.icon),
																			{ className: "h-3 w-3" },
																		)}
																	</span>
																	<span className="flex-1 truncate text-left">{category.name}</span>
																</Button>
															))}
													</div>
												</ContextMenuSubContent>
											</ContextMenuSub>
										)}
										<ContextMenuSeparator />
										<ContextMenuItem
											onClick={handleDeleteSelected}
											variant="destructive"
										>
											<Trash2 className="mr-2 h-4 w-4" />
											Delete {selectionCount} selected
										</ContextMenuItem>
									</>
								);
							}

							return (
								<>
									<ContextMenuItem
										onClick={() => {
											openExpense(row.id);
											setSelectedExpenseIds(new Set());
										}}
									>
										<Edit2 className="mr-2 h-4 w-4" />
										Edit expense
									</ContextMenuItem>
									<ContextMenuItem onClick={() => handleDuplicate(row.id)}>
										<Copy className="mr-2 h-4 w-4" />
										Duplicate expense
									</ContextMenuItem>
									<ContextMenuSeparator />
									<ContextMenuItem
										onClick={() => {
											setSelectedExpenseIds(new Set([row.id]));
											setShowDeleteDialog(true);
										}}
										variant="destructive"
									>
										<Trash2 className="mr-2 h-4 w-4" />
										Delete expense
									</ContextMenuItem>
								</>
							);
						}}
						renderToolbar={(_table, headerHeight) => (
							<DataTableSelectionBar
								categories={allCategories}
								exportMutation={{ isPending: isExporting }}
								headerHeight={headerHeight}
								onDeleteSelected={handleDeleteSelected}
								onDuplicateSelected={handleDuplicate}
								onEditSelected={(id) => {
									if (id.startsWith("shared:")) {
										const txId = id.slice("shared:".length);
										openSharedExpense(txId);
									} else {
										openExpense(id);
									}
									setSelectedExpenseIds(new Set());
								}}
								onExportSelected={handleExportSelected}
								onRecategorize={handleRecategorize}
								onSelectAll={handleSelectAll}
								selectedRows={selectedExpenseIds}
							/>
						)}
						rowClassName={(row) =>
							row.original.excludeFromAnalytics ? "opacity-60" : undefined
						}
						selectedRows={selectedExpenseIds}
						totalCount={filteredExpenses.length}
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
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={isDeleting}
							onClick={confirmDelete}
							variant="destructive"
						>
							{isDeleting ? "Deleting..." : "Delete Expenses"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{/* Shared Expense Deletion Dialog */}
			<Dialog onOpenChange={(open) => { if (!open) setPendingSharedDelete(null); }} open={pendingSharedDelete !== null}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Shared Expense</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this shared expense? All participants will be notified. This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteSharedTxMutation.isPending}
							onClick={() => setPendingSharedDelete(null)}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteSharedTxMutation.isPending}
							onClick={() => {
								if (pendingSharedDelete) {
									deleteSharedTxMutation.mutate({ id: pendingSharedDelete });
								}
							}}
							variant="destructive"
						>
							{deleteSharedTxMutation.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

export default function Page() {
	return (
		<Suspense
			fallback={
				<>
					<SiteHeader title="Transactions" />
					<PageContent>
						<div className="flex h-64 items-center justify-center">
							<div className="text-muted-foreground">Loading...</div>
						</div>
					</PageContent>
				</>
			}
		>
			<TransactionsContent />
		</Suspense>
	);
}

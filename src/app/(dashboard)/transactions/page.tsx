"use client";

import {
	Check,
	ClipboardCopy,
	Copy,
	Download,
	Edit2,
	Receipt,
	Search,
	Tags,
	Trash2,
	UserMinus,
	X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createElement, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { createExpenseColumns } from "~/components/data-table-columns";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
import { ExpenseActionsSheet } from "~/components/expense-actions-sheet";
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
import { Input } from "~/components/ui/input";
import { useCategoryName } from "~/hooks/use-category-name";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useExpensesController } from "~/hooks/use-expenses-controller";
import { useIsMobile } from "~/hooks/use-mobile";
import { useTableActions } from "~/hooks/use-table-actions";
import { getCategoryIcon } from "~/lib/category-icons";
import { getCategoryColorClasses } from "~/lib/constants";
import { formatExpenseAsText } from "~/lib/format";
import { cn, convertExpenseAmountForDisplay } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ExpensesTableFooter } from "./_components/expenses-table-footer";
import { FilterBar } from "./_components/filter-bar";

function TransactionsContent() {
	const t = useTranslations("transactions");
	const tc = useTranslations("common");
	const locale = useLocale();
	const { openNewExpense, openExpense, openSharedExpense, openDuplicateExpense } =
		useExpenseModal();
	const { formatCurrency } = useCurrencyFormatter();
	const { displayName } = useCategoryName();
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
	// The expense whose detail/actions sheet is open (null = closed). Opened by the
	// per-row "⋯" trigger on any screen, or by a plain row tap on mobile.
	const [sheetExpenseId, setSheetExpenseId] = useState<string | null>(null);

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
		projectFilter,
		setProjectFilter,
		availableProjects,
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
		deletableSelectedCount,
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
			toast.success(t("sharedDeleted"));
			setPendingSharedDelete(null);
			void utils.expense.listSharedParticipations.invalidate();
			void utils.dashboard.getOverviewStats.invalidate();
			void utils.dashboard.getRecentActivity.invalidate();
			void utils.stats.invalidate();
			void utils.budget.getBudgets.invalidate();
		},
		onError: () => {
			toast.error(t("sharedDeleteFailed"));
		},
	});

	// Invalidate everything a change to the caller's shared participation touches.
	const invalidateSharedParticipation = () => {
		void utils.expense.listSharedParticipations.invalidate();
		void utils.dashboard.getOverviewStats.invalidate();
		void utils.dashboard.getRecentActivity.invalidate();
		void utils.stats.invalidate();
		void utils.budget.getBudgets.invalidate();
		void utils.verification.queue.invalidate();
	};

	// Accept / reject the caller's own pending verification on a shared expense.
	const acceptSharedMutation = api.verification.accept.useMutation({
		onSuccess: () => {
			toast.success(t("expenseAccepted"));
			invalidateSharedParticipation();
		},
		onError: (e) => toast.error(e.message),
	});

	const [pendingReject, setPendingReject] = useState<string | null>(null);
	const [rejectReason, setRejectReason] = useState("");
	const rejectSharedMutation = api.verification.reject.useMutation({
		onSuccess: () => {
			toast.success(t("expenseRejected"));
			invalidateSharedParticipation();
			setPendingReject(null);
			setRejectReason("");
		},
		onError: (e) => toast.error(e.message),
	});

	// "Remove me" — deletes only the caller's own split from the shared expense.
	const [pendingRemoveSelf, setPendingRemoveSelf] = useState<string | null>(
		null,
	);
	const removeSelfMutation = api.verification.removeSelf.useMutation({
		onSuccess: () => {
			toast.success(t("removed"));
			invalidateSharedParticipation();
			setPendingRemoveSelf(null);
		},
		onError: (e) => {
			toast.error(e.message || t("removeFailed"));
			setPendingRemoveSelf(null);
		},
	});

	const handleRecategorize = async (categoryId: string) => {
		// Recategorize only targets personal expenses the caller owns. Shared
		// rows carry a synthetic `shared:<txnId>` id which is not a real expense
		// key — including one would make the whole mutation fail input validation
		// server-side, so filter them out and skip if nothing is left.
		const personalSelectedIds = new Set(
			filteredExpenses
				.filter((e) => e.source !== "shared" && selectedExpenseIds.has(e.id))
				.map((e) => e.id),
		);
		const ids = Array.from(personalSelectedIds);
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
				t("updatedCategory", { count: result.count, category: result.categoryName }),
			);
		} catch {
			toast.error(t("recategorizeFailed"));
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

	// The expense backing the actions sheet, resolved from the current list.
	const sheetExpense =
		sheetExpenseId != null
			? (filteredExpenses.find((e) => e.id === sheetExpenseId) ?? null)
			: null;

	// Shared copy-as-text used by both the context menu and the actions sheet.
	const copyExpenseAsText = (expense: (typeof filteredExpenses)[number]) => {
		const text = formatExpenseAsText(
			expense.title,
			expense.amount,
			expense.currency,
			new Date(expense.date),
			formatCurrency,
			locale,
		);
		void navigator.clipboard.writeText(text);
		toast.success(t("copiedToClipboard"));
	};

	// Open the editor for either a personal or shared expense. Shared rows only
	// open when the caller can actually edit — never hand a viewer a saveable
	// editor the server will reject (the "impossible actions" invariant).
	const openExpenseEditor = (expense: (typeof filteredExpenses)[number]) => {
		if (expense.source === "shared") {
			if (expense.sharedContext?.canEdit && expense.sharedContext.transactionId) {
				openSharedExpense(expense.sharedContext.transactionId);
				setSelectedExpenseIds(new Set());
			} else {
				toast.info(t("noEditPermission"));
			}
			return;
		}
		openExpense(expense.id);
		setSelectedExpenseIds(new Set());
	};

	// Delete for either kind. Personal goes through the multi-delete confirm
	// dialog (single id); shared goes through the shared-delete confirm dialog.
	const deleteExpense = (expense: (typeof filteredExpenses)[number]) => {
		if (expense.source === "shared") {
			if (expense.sharedContext?.transactionId) {
				setPendingSharedDelete(expense.sharedContext.transactionId);
			}
			return;
		}
		setSelectedExpenseIds(new Set([expense.id]));
		setShowDeleteDialog(true);
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
				t,
				locale,
				(id) => setSheetExpenseId(id),
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
		projectFilter,
		setProjectFilter,
		availableProjects,
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
		searchPlaceholder: t("searchExpenses"),
		displayedCount,
	};

	if (isLoading) {
		return (
			<>
				<SiteHeader title={t("title")} />
				<PageContent>
					<div className="flex h-64 items-center justify-center">
						<div className="text-muted-foreground">{t("loading")}</div>
					</div>
				</PageContent>
			</>
		);
	}

	if (isError) {
		return (
			<>
				<SiteHeader title={t("title")} />
				<PageContent>
					<div className="flex h-64 items-center justify-center">
						<div className="text-destructive">{t("error")}</div>
					</div>
				</PageContent>
			</>
		);
	}

	const handleCreateExpense = () => {
		toast.dismiss();
		toast.info(t("newExpenseDraft"));
		openNewExpense();
	};

	return (
		<>
			<SiteHeader title={t("title")} />
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
							// Impossible actions must not appear: a participant without
							// edit rights (e.g. a project VIEWER a split was shared to)
							// must never be handed a saveable editor the server rejects.
							const expense = filteredExpenses.find((e) => e.id === id);
							if (expense) openExpenseEditor(expense);
						}}
						// Mobile: a plain row tap opens the detail/actions sheet instead
						// of the edit modal, giving mobile participants a way to reach the
						// contextual actions the desktop right-click menu provides.
						onMobileRowActivate={(row) => setSheetExpenseId(row.id)}
						emptyState={
							<EmptyState
								action={
									typeFilter !== "shared"
										? { label: t("addExpense"), onClick: handleCreateExpense }
										: undefined
								}
								description={
									typeFilter === "shared"
										? t("noShared")
										: filteredExpenses.length === 0 && !isLoading
											? t("noExpensesYet")
											: t("noFiltersMatch")
								}
								icon={Receipt}
								secondaryAction={{
									label: t("resetFilters"),
									onClick: clearFilters,
									variant: "outline",
								}}
								title={
									typeFilter === "shared"
										? t("noSharedTitle")
										: filteredExpenses.length === 0 && !isLoading
											? t("noExpensesTitle")
											: t("noResults")
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
									t={t}
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
								const isLocked = !!sharedCtx?.isLocked;
								const isPending =
									sharedCtx?.myVerificationStatus === "PENDING" && !isLocked;
								// A participant can remove their own split from an unsettled
								// shared expense — the useful action for a plain participant
								// with no edit/delete rights. Creators are excluded: removing
								// themselves would hide the expense from their own view while
								// leaving it live for everyone else, so they delete instead.
								const canRemoveSelf = !isLocked && !sharedCtx?.isCreator;
								// Always render a menu for shared rows the user participates in:
								// copy is always available, plus accept/reject/remove/delete
								// depending on state and permissions.
								return (
									<>
										{isPending && (
											<>
												<ContextMenuItem
													onClick={() =>
														acceptSharedMutation.mutate({ txnId: sharedTxId })
													}
												>
													<Check className="mr-2 h-4 w-4 text-emerald-500" />
													{t("accept")}
												</ContextMenuItem>
												<ContextMenuItem
													onClick={() => {
														setPendingReject(sharedTxId);
														setRejectReason("");
													}}
												>
													<X className="mr-2 h-4 w-4 text-rose-500" />
													{t("reject")}
												</ContextMenuItem>
												<ContextMenuSeparator />
											</>
										)}
										{canEdit && (
											<ContextMenuItem
												onClick={() => {
													openSharedExpense(sharedTxId);
													setSelectedExpenseIds(new Set());
												}}
											>
												<Edit2 className="mr-2 h-4 w-4" />
												{t("editExpense")}
											</ContextMenuItem>
										)}
										<ContextMenuItem
											onClick={() => {
												const text = formatExpenseAsText(
													row.title,
													row.amount,
													row.currency,
													new Date(row.date),
													formatCurrency,
													locale,
												);
												void navigator.clipboard.writeText(text);
												toast.success(t("copiedToClipboard"));
											}}
										>
											<ClipboardCopy className="mr-2 h-4 w-4" />
											{t("copyAsText")}
										</ContextMenuItem>
										{canRemoveSelf && (
											<>
												<ContextMenuSeparator />
												<ContextMenuItem
													onClick={() => setPendingRemoveSelf(sharedTxId)}
												>
													<UserMinus className="mr-2 h-4 w-4" />
													{t("removeMe")}
												</ContextMenuItem>
											</>
										)}
										{canDelete && (
											<>
												<ContextMenuSeparator />
												<ContextMenuItem
													onClick={() => setPendingSharedDelete(sharedTxId)}
													variant="destructive"
												>
													<Trash2 className="mr-2 h-4 w-4" />
													{t("deleteExpense")}
												</ContextMenuItem>
											</>
										)}
									</>
								);
							}

							const isInSelection = selectedExpenseIds.has(row.id);
							const selectionCount = selectedExpenseIds.size;
							const isMultiSelected = isInSelection && selectionCount > 1;
							// Bulk delete and bulk recategorize only operate on personal
							// rows the caller owns; shared rows go through their own gated
							// flows and would fail these mutations, so gate both affordances
							// on how many personal rows are in the selection.
							const personalInSelection = filteredExpenses.filter(
								(e) => e.source !== "shared" && selectedExpenseIds.has(e.id),
							).length;

							if (isMultiSelected) {
								return (
									<>
										<ContextMenuItem
											onClick={() => void handleExportSelected()}
										>
											<Download className="mr-2 h-4 w-4" />
											{t("exportSelected", { count: selectionCount })}
										</ContextMenuItem>
										{allCategories && allCategories.length > 0 && personalInSelection > 0 && (
											<ContextMenuSub onOpenChange={(open) => { if (!open) setCategorySearch(""); }}>
												<ContextMenuSubTrigger className="gap-2">
													<Tags className="size-4" />
													{t("recategorizeSelected", { count: personalInSelection })}
												</ContextMenuSubTrigger>
												<ContextMenuSubContent className="w-56 p-0">
													<div className="flex items-center gap-2 border-b px-3 py-2">
														<Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
														<input
															className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
															placeholder={t("searchCategories")}
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
																	<span className="flex-1 truncate text-left">{displayName(category.name)}</span>
																</Button>
															))}
													</div>
												</ContextMenuSubContent>
											</ContextMenuSub>
										)}
										{personalInSelection > 0 && (
											<>
												<ContextMenuSeparator />
												<ContextMenuItem
													onClick={handleDeleteSelected}
													variant="destructive"
												>
													<Trash2 className="mr-2 h-4 w-4" />
													{t("deleteSelected", { count: personalInSelection })}
												</ContextMenuItem>
											</>
										)}
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
										{t("editExpense")}
									</ContextMenuItem>
									<ContextMenuItem onClick={() => handleDuplicate(row.id)}>
										<Copy className="mr-2 h-4 w-4" />
										{t("duplicateExpense")}
									</ContextMenuItem>
									<ContextMenuItem
										onClick={() => {
											const text = formatExpenseAsText(
												row.title,
												row.amount,
												row.currency,
												new Date(row.date),
												formatCurrency,
											);
											void navigator.clipboard.writeText(text);
											toast.success(t("copiedToClipboard"));
										}}
									>
										<ClipboardCopy className="mr-2 h-4 w-4" />
										{t("copyAsText")}
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
										{t("deleteExpense")}
									</ContextMenuItem>
								</>
							);
						}}
						renderToolbar={(_table, headerHeight) => {
							// When exactly one row is selected, decide whether the Edit
							// affordance may appear: personal rows are always editable by
							// their owner; shared rows only when sharedContext.canEdit.
							const singleSelectedId =
								selectedExpenseIds.size === 1
									? Array.from(selectedExpenseIds)[0]
									: undefined;
							const singleSelected = singleSelectedId
								? filteredExpenses.find((e) => e.id === singleSelectedId)
								: undefined;
							const canEditSelected = singleSelected
								? singleSelected.source !== "shared" ||
									!!singleSelected.sharedContext?.canEdit
								: true;
							return (
								<DataTableSelectionBar
									canDeleteSelected={deletableSelectedCount > 0}
									canEditSelected={canEditSelected}
									canRecategorize={deletableSelectedCount > 0}
									categories={allCategories}
									exportMutation={{ isPending: isExporting }}
									headerHeight={headerHeight}
									onDeleteSelected={handleDeleteSelected}
									onDuplicateSelected={handleDuplicate}
									onEditSelected={(id) => {
										const expense = filteredExpenses.find((e) => e.id === id);
										if (expense?.source === "shared") {
											// Never open a saveable editor a participant can't save.
											if (
												expense.sharedContext?.canEdit &&
												expense.sharedContext.transactionId
											) {
												openSharedExpense(expense.sharedContext.transactionId);
												setSelectedExpenseIds(new Set());
											} else {
												toast.info(t("noEditPermission"));
											}
											return;
										}
										openExpense(id);
										setSelectedExpenseIds(new Set());
									}}
									onExportSelected={handleExportSelected}
									onRecategorize={handleRecategorize}
									onSelectAll={handleSelectAll}
									selectedRows={selectedExpenseIds}
								/>
							);
						}}
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
						<DialogTitle>{t("deleteExpensesTitle")}</DialogTitle>
						<DialogDescription>
							{t("deleteExpensesDescription", { count: deletableSelectedCount })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={isDeleting}
							onClick={() => setShowDeleteDialog(false)}
							variant="ghost"
						>
							{tc("cancel")}
						</Button>
						<Button
							disabled={isDeleting}
							onClick={confirmDelete}
							variant="destructive"
						>
							{isDeleting ? tc("deleting") : t("deleteExpensesTitle")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{/* Shared Expense Deletion Dialog */}
			<Dialog onOpenChange={(open) => { if (!open) setPendingSharedDelete(null); }} open={pendingSharedDelete !== null}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("deleteSharedTitle")}</DialogTitle>
						<DialogDescription>
							{t("deleteSharedDescription")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteSharedTxMutation.isPending}
							onClick={() => setPendingSharedDelete(null)}
							variant="ghost"
						>
							{tc("cancel")}
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
							{deleteSharedTxMutation.isPending ? tc("deleting") : tc("delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{/* Reject Shared Expense Dialog (with optional reason) */}
			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						setPendingReject(null);
						setRejectReason("");
					}
				}}
				open={pendingReject !== null}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("rejectThisExpense")}</DialogTitle>
						<DialogDescription>{t("rejectReasonPrompt")}</DialogDescription>
					</DialogHeader>
					<Input
						autoFocus
						maxLength={500}
						onChange={(e) => setRejectReason(e.target.value)}
						placeholder={t("reasonOptional")}
						value={rejectReason}
					/>
					<DialogFooter>
						<Button
							disabled={rejectSharedMutation.isPending}
							onClick={() => {
								setPendingReject(null);
								setRejectReason("");
							}}
							variant="ghost"
						>
							{tc("cancel")}
						</Button>
						<Button
							disabled={rejectSharedMutation.isPending}
							onClick={() => {
								if (pendingReject) {
									rejectSharedMutation.mutate({
										txnId: pendingReject,
										reason: rejectReason.trim() || undefined,
									});
								}
							}}
							variant="destructive"
						>
							{t("reject")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{/* Remove Me Dialog */}
			<Dialog
				onOpenChange={(open) => {
					if (!open) setPendingRemoveSelf(null);
				}}
				open={pendingRemoveSelf !== null}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("removeMeTitle")}</DialogTitle>
						<DialogDescription>{t("removeMeDescription")}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={removeSelfMutation.isPending}
							onClick={() => setPendingRemoveSelf(null)}
							variant="ghost"
						>
							{tc("cancel")}
						</Button>
						<Button
							disabled={removeSelfMutation.isPending}
							onClick={() => {
								if (pendingRemoveSelf) {
									removeSelfMutation.mutate({ txnId: pendingRemoveSelf });
								}
							}}
							variant="destructive"
						>
							{removeSelfMutation.isPending ? tc("deleting") : t("removeMe")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{/* Expense detail + actions sheet (mobile tap target / read-only view) */}
			<ExpenseActionsSheet
				expense={sheetExpense}
				onAccept={(txnId) => acceptSharedMutation.mutate({ txnId })}
				onCopy={copyExpenseAsText}
				onDelete={deleteExpense}
				onDuplicate={handleDuplicate}
				onEdit={openExpenseEditor}
				onOpenChange={(open) => {
					if (!open) setSheetExpenseId(null);
				}}
				onReject={(txnId) => {
					setPendingReject(txnId);
					setRejectReason("");
				}}
				onRemoveSelf={(txnId) => setPendingRemoveSelf(txnId)}
				open={sheetExpense !== null}
			/>
		</>
	);
}

export default function Page() {
	const t = useTranslations("transactions");
	return (
		<Suspense
			fallback={
				<>
					<SiteHeader title={t("title")} />
					<PageContent>
						<div className="flex h-64 items-center justify-center">
							<div className="text-muted-foreground">{t("suspenseLoading")}</div>
						</div>
					</PageContent>
				</>
			}
		>
			<TransactionsContent />
		</Suspense>
	);
}

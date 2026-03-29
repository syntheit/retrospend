"use client";

import type { Row } from "@tanstack/react-table";
import { formatExpenseDate } from "~/lib/format";
import {
	Check,
	Edit2,
	History,
	Receipt,
	SlidersHorizontal,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { ExpandableSearch } from "~/components/table-search";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
import { ExpenseModal } from "~/components/expense-modal";
import {
	createProjectExpenseColumns,
	type ProjectExpense,
} from "~/components/project/expenses-table-columns";
import { useRevisionHistory } from "~/components/revision-history-provider";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirmation-dialog";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "~/components/ui/context-menu";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "~/components/ui/drawer";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useIsMobile } from "~/hooks/use-mobile";
import { getCategoryIcon } from "~/lib/category-icons";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const STATUS_OPTIONS = [
	{ value: "pending", label: "Needs Review" },
	{ value: "active", label: "Confirmed" },
	{ value: "settled", label: "Settled" },
	{ value: "disputed", label: "Disputed" },
] as const;

interface ExpensesTableProps {
	projectId: string;
	billingPeriodId?: string;
	isSolo?: boolean;
	isReadOnly?: boolean;
	onAddExpense?: () => void;
	/** Incrementing counter — each bump filters the table to "pending" status */
	pendingFilterTrigger?: number;
	currentParticipant?: { type: string; id: string };
}

export function ExpensesTable({
	projectId,
	billingPeriodId,
	isSolo,
	isReadOnly = false,
	onAddExpense,
	pendingFilterTrigger,
	currentParticipant,
}: ExpensesTableProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const { openHistory } = useRevisionHistory();
	const isMobile = useIsMobile();

	// External filter state (category, split participant, status)
	const [filterOpen, setFilterOpen] = useState(false);
	const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
		new Set(),
	);
	const [selectedSplitIds, setSelectedPaidByIds] = useState<Set<string>>(
		new Set(),
	);
	const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(
		new Set(),
	);
	const [searchValue, setSearchValue] = useState("");
	const [searchFilteredCount, setSearchFilteredCount] = useState(0);

	// Sync pending filter trigger (e.g. from clicking verification progress bar)
	useEffect(() => {
		if (pendingFilterTrigger && pendingFilterTrigger > 0) {
			setSelectedStatuses(new Set(["pending"]));
		}
	}, [pendingFilterTrigger]);

	// Action state (modals)
	const [editingTransactionId, setEditingTransactionId] = useState<
		string | null
	>(null);
	const [deletingTransaction, setDeletingTransaction] = useState<{
		id: string;
		description: string;
		amount: number;
		currency: string;
		date: Date;
	} | null>(null);

	// Selection state
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
	const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
	const [isBulkDeleting, setIsBulkDeleting] = useState(false);

	const handleRowSelect = useCallback((id: string, checked: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
		if (checked) setLastSelectedId(id);
	}, []);

	const handleRangeSelect = useCallback((ids: string[]) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			for (const id of ids) next.add(id);
			return next;
		});
		if (ids.length > 0) setLastSelectedId(ids[ids.length - 1]!);
	}, []);

	// Ref so handleSelectAll doesn't need to be recreated when filteredTransactions changes
	const filteredTransactionsRef = useRef<typeof filteredTransactions>([]);

	const handleSelectAll = useCallback((checked: boolean) => {
		if (checked) {
			setSelectedIds(new Set(filteredTransactionsRef.current.map((t) => t.id)));
		} else {
			setSelectedIds(new Set());
		}
	}, []);

	const utils = api.useUtils();
	const deleteMutation = api.sharedTransaction.delete.useMutation({
		onSuccess: () => {
			toast.success("Expense deleted");
			void utils.project.listExpenses.invalidate({ projectId });
			void utils.project.detail.invalidate({ id: projectId });
			void utils.people.list.invalidate();
			setDeletingTransaction(null);
		},
		onError: (e) => {
			toast.error(e.message);
			setDeletingTransaction(null);
		},
	});

	const handleBulkDelete = async () => {
		setIsBulkDeleting(true);
		try {
			await Promise.all(
				Array.from(selectedIds).map((id) => deleteMutation.mutateAsync({ id })),
			);
			setSelectedIds(new Set());
			setShowBulkDeleteDialog(false);
			void utils.project.listExpenses.invalidate({ projectId });
			void utils.project.detail.invalidate({ id: projectId });
			void utils.people.list.invalidate();
			toast.success("Expenses deleted");
		} catch {
			toast.error("Failed to delete some expenses");
		} finally {
			setIsBulkDeleting(false);
		}
	};

	// Reject reason popover state
	const [rejectingTxnId, setRejectingTxnId] = useState<string | null>(null);
	const [rejectReason, setRejectReason] = useState("");

	const invalidateVerification = useCallback(() => {
		void utils.project.listExpenses.invalidate({ projectId });
		void utils.project.detail.invalidate({ id: projectId });
		void utils.verification.queue.invalidate();
		void utils.people.list.invalidate();
	}, [utils, projectId]);

	const acceptMutation = api.verification.accept.useMutation({
		onSuccess: () => {
			toast.success("Expense accepted");
			invalidateVerification();
		},
		onError: (e) => toast.error(e.message),
	});

	const rejectMutation = api.verification.reject.useMutation({
		onSuccess: () => {
			toast.success("Expense rejected");
			invalidateVerification();
			setRejectingTxnId(null);
			setRejectReason("");
		},
		onError: (e) => toast.error(e.message),
	});

	// Stable refs so column memoization isn't defeated by mutation object identity
	const acceptRef = useRef(acceptMutation.mutate);
	acceptRef.current = acceptMutation.mutate;
	const rejectMutateRef = useRef(rejectMutation.mutate);
	rejectMutateRef.current = rejectMutation.mutate;

	const handleAccept = useCallback(
		(txnId: string) => acceptRef.current({ txnId }),
		[],
	);

	const handleReject = useCallback((txnId: string) => {
		setRejectingTxnId(txnId);
		setRejectReason("");
	}, []);

	const handleRejectConfirm = useCallback(() => {
		if (!rejectingTxnId) return;
		rejectMutateRef.current({
			txnId: rejectingTxnId,
			reason: rejectReason.trim() || undefined,
		});
	}, [rejectingTxnId, rejectReason]);

	// Fetch all expenses at once for client-side filtering
	const { data, isLoading, isError } = api.project.listExpenses.useQuery({
		projectId,
		billingPeriodId,
		page: 1,
		limit: 500,
	});

	const allTransactions = data?.transactions ?? [];

	// Derive available filter options from loaded data
	const availableCategories = useMemo(() => {
		const map = new Map<string, { id: string; name: string; color: string; icon: string | null }>();
		for (const t of allTransactions) {
			if (t.category) map.set(t.category.id, t.category);
		}
		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
	}, [allTransactions]);

	const availableParticipants = useMemo(() => {
		const map = new Map<
			string,
			{ compositeId: string; name: string; avatarUrl: string | null }
		>();
		for (const t of allTransactions) {
			for (const sp of t.splitParticipants ?? []) {
				const key = `${sp.participantType}:${sp.participantId}`;
				if (!map.has(key)) {
					map.set(key, { compositeId: key, name: sp.name, avatarUrl: sp.avatarUrl });
				}
			}
		}
		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
	}, [allTransactions]);

	// Apply external filters (category, split participant, status) - text search handled by DataTable
	const filteredTransactions = useMemo<ProjectExpense[]>(() => {
		let result = allTransactions as ProjectExpense[];

		if (selectedCategories.size > 0) {
			result = result.filter(
				(t) => t.category && selectedCategories.has(t.category.id),
			);
		}

		if (selectedSplitIds.size > 0) {
			result = result.filter((t) =>
				(t.splitParticipants ?? []).some((sp) =>
					selectedSplitIds.has(`${sp.participantType}:${sp.participantId}`),
				),
			);
		}

		if (selectedStatuses.size > 0) {
			result = result.filter((t) => selectedStatuses.has(t.status));
		}

		return result;
	}, [
		allTransactions,
		selectedCategories,
		selectedSplitIds,
		selectedStatuses,
	]);
	filteredTransactionsRef.current = filteredTransactions;

	// Revision summaries for all filtered transactions
	const txnIds = useMemo(
		() => filteredTransactions.map((t) => t.id),
		[filteredTransactions],
	);
	const { data: revisionSummaries } =
		api.auditLog.transactionRevisionSummary.useQuery(
			{ transactionIds: txnIds },
			{ enabled: txnIds.length > 0 },
		);

	const totalAll = allTransactions.length;
	const totalFiltered = filteredTransactions.length;
	const hasExternalFilters =
		selectedCategories.size > 0 ||
		selectedSplitIds.size > 0 ||
		selectedStatuses.size > 0;

	const activeFilterCount =
		selectedCategories.size + selectedSplitIds.size + selectedStatuses.size;

	const barCountLabel = (() => {
		const total = totalFiltered;
		const displayed = searchValue ? searchFilteredCount : total;
		const noun = displayed === 1 ? "expense" : "expenses";
		if (searchValue && displayed < total) {
			return `${displayed} of ${total} ${noun}`;
		}
		return `${total} ${noun}`;
	})();

	function clearFilters() {
		setSelectedCategories(new Set());
		setSelectedPaidByIds(new Set());
		setSelectedStatuses(new Set());
	}

	function toggleCategory(id: string) {
		setSelectedCategories((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleSplitParticipant(id: string) {
		setSelectedPaidByIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleStatus(status: string) {
		setSelectedStatuses((prev) => {
			const next = new Set(prev);
			if (next.has(status)) next.delete(status);
			else next.add(status);
			return next;
		});
	}

	// Column definitions - memoized so they only rebuild when dependencies change
	const columns = useMemo(
		() =>
			createProjectExpenseColumns({
				isSolo,
				isReadOnly,
				formatCurrency,
				revisionSummaries: revisionSummaries ?? undefined,
				currentParticipant,
				onEdit: (id) => setEditingTransactionId(id),
				onDelete: (txn) => setDeletingTransaction(txn),
				onViewHistory: (id) => openHistory(id),
				onAccept: handleAccept,
				onReject: handleReject,
			}),
		[isSolo, isReadOnly, formatCurrency, revisionSummaries, openHistory, currentParticipant, handleAccept, handleReject],
	);

	// Row class for settled rows
	const rowClassName = useMemo(
		() => (row: Row<ProjectExpense>) =>
			row.original.status === "settled"
				? "text-muted-foreground/60 opacity-60"
				: undefined,
		[],
	);

	const filterPanel = (
		<div className="space-y-3">
			{/* Status (group projects only) */}
			{!isSolo && (
				<div className="space-y-1.5">
					<p className="font-medium text-muted-foreground text-xs tracking-wide">
						Status
					</p>
					<div className="flex flex-wrap gap-1.5">
						{STATUS_OPTIONS.map(({ value, label }) => (
							<Button
								aria-pressed={selectedStatuses.has(value)}
								className="h-7 px-2.5 text-xs"
								key={value}
								onClick={() => toggleStatus(value)}
								size="sm"
								variant={selectedStatuses.has(value) ? "default" : "outline"}
							>
								{label}
							</Button>
						))}
					</div>
				</div>
			)}

			{/* Category */}
			{availableCategories.length > 0 && (
				<div className="space-y-1.5">
					<p className="font-medium text-muted-foreground text-xs tracking-wide">
						Category
					</p>
					<div className="flex flex-wrap gap-1.5">
						{availableCategories.map((cat) => {
							const Icon = getCategoryIcon(cat.name, cat.icon);
							return (
								<Button
									aria-pressed={selectedCategories.has(cat.id)}
									className="h-7 gap-1.5 px-2.5 text-xs"
									key={cat.id}
									onClick={() => toggleCategory(cat.id)}
									size="sm"
									variant={selectedCategories.has(cat.id) ? "default" : "outline"}
								>
									<Icon
										className={cn(
											"h-3 w-3 shrink-0",
											!selectedCategories.has(cat.id) &&
												`text-${cat.color}-500`,
										)}
									/>
									{cat.name}
								</Button>
							);
						})}
					</div>
				</div>
			)}

			{/* Split With (only in group projects) */}
			{!isSolo && availableParticipants.length > 0 && (
				<div className="space-y-1.5">
					<p className="font-medium text-muted-foreground text-xs tracking-wide">
						Split With
					</p>
					<div className="flex flex-wrap gap-1.5">
						{availableParticipants.map((participant) => (
							<Button
								aria-pressed={selectedSplitIds.has(participant.compositeId)}
								className="h-7 gap-1.5 px-2.5 text-xs"
								key={participant.compositeId}
								onClick={() => toggleSplitParticipant(participant.compositeId)}
								size="sm"
								variant={
									selectedSplitIds.has(participant.compositeId) ? "default" : "outline"
								}
							>
								<UserAvatar
									avatarUrl={participant.avatarUrl}
									className="h-4 w-4 text-[8px]"
									name={participant.name}
									size="xs"
								/>
								{participant.name.split(" ")[0]}
							</Button>
						))}
					</div>
				</div>
			)}

			{/* Clear */}
			{activeFilterCount > 0 && (
				<Button
					className="h-7 px-2.5 text-xs"
					onClick={clearFilters}
					size="sm"
					variant="ghost"
				>
					Clear filters
				</Button>
			)}
		</div>
	);

	return (
		<div className="flex flex-col">
			{/* Count + Filter + Search bar */}
			<div className="mb-3 flex items-center gap-2">
				<span className="shrink-0 tabular-nums text-muted-foreground text-sm">
					{barCountLabel}
				</span>

				{/* Filter toggle button */}
				{isMobile ? (
					<>
						<Button
							className="relative h-7 px-2 text-xs"
							onClick={() => setFilterOpen(true)}
							size="sm"
							variant={activeFilterCount > 0 ? "secondary" : "ghost"}
						>
							<SlidersHorizontal className="h-3.5 w-3.5" />
							Filters
							{activeFilterCount > 0 && (
								<span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground">
									{activeFilterCount}
								</span>
							)}
						</Button>
						<Drawer
							direction="bottom"
							onOpenChange={setFilterOpen}
							open={filterOpen}
						>
							<DrawerContent className="px-6 pb-8">
								<DrawerTitle className="mb-2 text-left font-semibold text-lg">
									Filters
								</DrawerTitle>
								<DrawerDescription className="sr-only">
									Filter expenses by status, category, and participants
								</DrawerDescription>
								<div className="overflow-y-auto">{filterPanel}</div>
							</DrawerContent>
						</Drawer>
					</>
				) : (
					<Popover onOpenChange={setFilterOpen} open={filterOpen}>
						<PopoverTrigger asChild>
							<Button
								className="relative h-7 px-2 text-xs"
								size="sm"
								variant={activeFilterCount > 0 ? "secondary" : "ghost"}
							>
								<SlidersHorizontal className="h-3.5 w-3.5" />
								Filters
								{activeFilterCount > 0 && (
									<span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground">
										{activeFilterCount}
									</span>
								)}
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-[400px] p-4"
							sideOffset={8}
						>
							{filterPanel}
						</PopoverContent>
					</Popover>
				)}

				<ExpandableSearch
					onChange={setSearchValue}
					placeholder="Search expenses..."
					value={searchValue}
					slashFocus
				/>
			</div>

			{/* Active filter summary */}
			{hasExternalFilters && (
				<div className="mb-3 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
					<span>
						Showing {totalFiltered} of {totalAll} expenses
					</span>
					{selectedStatuses.size > 0 && (
						<span className="text-foreground">
							·{" "}
							{[...selectedStatuses]
								.map(
									(s) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s,
								)
								.join(", ")}
						</span>
					)}
					{selectedCategories.size > 0 && (
						<span className="text-foreground">
							·{" "}
							{[...selectedCategories]
								.map(
									(id) =>
										availableCategories.find((c) => c.id === id)?.name ?? id,
								)
								.join(", ")}
						</span>
					)}
					{selectedSplitIds.size > 0 && (
						<span className="text-foreground">
							· Split with{" "}
							{[...selectedSplitIds]
								.map((id) => {
									const p = availableParticipants.find((p) => p.compositeId === id);
									return p?.name.split(" ")[0] ?? id;
								})
								.join(", ")}
						</span>
					)}
					<Button
						className="h-auto p-0 font-medium text-primary hover:underline"
						onClick={clearFilters}
						type="button"
						variant="link"
					>
						Clear all
					</Button>
				</div>
			)}

			{/* Table */}
			{isError ? (
				<div className="rounded-xl border border-border border-dashed py-12 text-center text-muted-foreground text-sm">
					Failed to load expenses.
				</div>
			) : isLoading ? (
				<div className="space-y-2">
					{[...Array(4)].map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
						<Skeleton className="h-12 w-full" key={i} />
					))}
				</div>
			) : totalAll === 0 ? (
				<div className="rounded-xl border border-border border-dashed">
					<EmptyState
						action={
							onAddExpense
								? { label: "Add Expense", onClick: onAddExpense }
								: undefined
						}
						description="Add your first expense to get started."
						icon={Receipt}
						title="No Expenses Yet"
					/>
				</div>
			) : filteredTransactions.length === 0 ? (
				<div className="rounded-xl border border-border border-dashed">
					<EmptyState
						action={{
							label: "Clear Filters",
							onClick: clearFilters,
							variant: "outline",
						}}
						description="Try adjusting or clearing your filters."
						icon={SlidersHorizontal}
						title="No Results"
					/>
				</div>
			) : (
				<DataTable
					columns={columns}
					countNoun="expenses"
					data={filteredTransactions}
					searchValue={searchValue}
					onSearchChange={setSearchValue}
					onFilteredCountChange={setSearchFilteredCount}
					emptyState={
						<div className="py-8 text-muted-foreground text-sm">
							No matching expenses.
						</div>
					}
					initialSorting={[{ id: "date", desc: true }]}
					isRowSelectable={isReadOnly ? () => false : undefined}
					lastSelectedId={lastSelectedId}
					onClearSelection={() => handleSelectAll(false)}
					onRangeSelect={handleRangeSelect}
					onRowSelect={handleRowSelect}
					progressive
					renderContextMenu={
						isReadOnly
							? undefined
							: (txn) => {
									const mySplit = currentParticipant
										? txn.splitParticipants?.find(
												(sp) =>
													sp.participantType === currentParticipant.type &&
													sp.participantId === currentParticipant.id,
											)
										: undefined;
									const isPending =
										mySplit?.verificationStatus === "PENDING" && !txn.isLocked;

									return (
										<>
											<ContextMenuItem onClick={() => openHistory(txn.id)}>
												<History className="mr-2 h-4 w-4" />
												View history
											</ContextMenuItem>
											{isPending && (
												<>
													<ContextMenuSeparator />
													<ContextMenuItem onClick={() => handleAccept(txn.id)}>
														<Check className="mr-2 h-4 w-4 text-emerald-500" />
														Accept
													</ContextMenuItem>
													<ContextMenuItem onClick={() => handleReject(txn.id)}>
														<X className="mr-2 h-4 w-4 text-rose-500" />
														Reject
													</ContextMenuItem>
												</>
											)}
											<ContextMenuSeparator />
											<ContextMenuItem
												disabled={!txn.canEdit || txn.isLocked}
												onClick={() => setEditingTransactionId(txn.id)}
											>
												<Edit2 className="mr-2 h-4 w-4" />
												Edit
											</ContextMenuItem>
											<ContextMenuItem
												disabled={!txn.canDelete || txn.isLocked}
												onClick={() =>
													setDeletingTransaction({
														id: txn.id,
														description: txn.description,
														amount: txn.amount,
														currency: txn.currency,
														date: new Date(txn.date),
													})
												}
												variant="destructive"
											>
												<Trash2 className="mr-2 h-4 w-4" />
												Delete
											</ContextMenuItem>
										</>
									);
								}
					}
					renderToolbar={
						isReadOnly
							? undefined
							: (_table, headerHeight) => (
									<DataTableSelectionBar
										headerHeight={headerHeight}
										onDeleteSelected={() => setShowBulkDeleteDialog(true)}
										onEditSelected={(id) => {
											setEditingTransactionId(id);
											setSelectedIds(new Set());
										}}
										onSelectAll={handleSelectAll}
										selectedRows={selectedIds}
									/>
								)
					}
					rowClassName={rowClassName}
					selectedRows={selectedIds}
					totalCount={totalFiltered}
				/>
			)}

			{editingTransactionId && (
				<ExpenseModal
					expenseId=""
					mode="edit"
					onOpenChange={(open) => {
						if (!open) setEditingTransactionId(null);
					}}
					open={!!editingTransactionId}
					sharedTransactionId={editingTransactionId}
					title="Edit Expense"
				/>
			)}

			<ConfirmDialog
				confirmText="Delete"
				description={
					deletingTransaction ? (
						<span>
							<strong>{deletingTransaction.description}</strong>
							<br />
							{formatCurrency(
								deletingTransaction.amount,
								deletingTransaction.currency,
							)}{" "}
							· {formatExpenseDate(deletingTransaction.date)}
							<br />
							<span className="text-destructive text-xs">
								This action cannot be undone. All participants will be notified.
							</span>
						</span>
					) : undefined
				}
				isLoading={deleteMutation.isPending}
				onConfirm={() => {
					if (deletingTransaction) {
						deleteMutation.mutate({ id: deletingTransaction.id });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setDeletingTransaction(null);
				}}
				open={!!deletingTransaction}
				title="Delete this expense?"
				variant="destructive"
			/>

			<ConfirmDialog
				confirmText="Delete"
				description={
					<span>
						Delete <strong>{selectedIds.size}</strong> expense
						{selectedIds.size !== 1 ? "s" : ""}?
						<br />
						<span className="text-destructive text-xs">
							This action cannot be undone. All participants will be notified.
						</span>
					</span>
				}
				isLoading={isBulkDeleting}
				onConfirm={() => void handleBulkDelete()}
				onOpenChange={(open) => {
					if (!open) setShowBulkDeleteDialog(false);
				}}
				open={showBulkDeleteDialog}
				title={`Delete ${selectedIds.size} expense${selectedIds.size !== 1 ? "s" : ""}?`}
				variant="destructive"
			/>

			{/* Reject reason popover */}
			<ConfirmDialog
				confirmText="Reject"
				description={
					<div className="space-y-2">
						<p className="text-sm">Optionally provide a reason for rejecting this expense.</p>
						<Input
							autoFocus
							maxLength={500}
							onChange={(e) => setRejectReason(e.target.value)}
							placeholder="Reason (optional)"
							value={rejectReason}
						/>
					</div>
				}
				isLoading={rejectMutation.isPending}
				onConfirm={handleRejectConfirm}
				onOpenChange={(open) => {
					if (!open) {
						setRejectingTxnId(null);
						setRejectReason("");
					}
				}}
				open={!!rejectingTxnId}
				title="Reject this expense?"
				variant="destructive"
			/>
		</div>
	);
}

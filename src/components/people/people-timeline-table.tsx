"use client";

import type { Row, VisibilityState } from "@tanstack/react-table";
import { Edit2, History, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
import {
	createTimelineColumns,
	type TimelineRow,
} from "~/components/people/people-timeline-columns";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "~/components/ui/context-menu";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { ConfirmDialog } from "~/components/ui/confirmation-dialog";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";

type ParticipantType = "user" | "guest" | "shadow";

export type AvailableCategory = { id: string; name: string; color: string; icon: string | null };
export type AvailablePayer = { name: string; avatarUrl: string | null; isMe: boolean };

interface PeopleTimelineTableProps {
	participantType: ParticipantType;
	participantId: string;
	identityName: string;
	selectedProjectId: string | null | undefined;
	statusFilter: "all" | "active";
	onStatusFilterChange: (filter: "all" | "active") => void;
	onCountChange?: (count: number) => void;
	onAvailableCategoriesChange?: (categories: AvailableCategory[]) => void;
	onAvailablePayersChange?: (payers: AvailablePayer[]) => void;
	searchValue: string;
	onSearchChange: (value: string) => void;
	selectedCategories: Set<string>;
	paidByFilter: "all" | "me" | "them";
	externalToolbar?: boolean;
	onEdit: (txnId: string) => void;
	onDelete: (txn: {
		id: string;
		description: string;
		amount: number;
		currency: string;
		date: Date;
	}) => void;
	onViewHistory: (txnId: string) => void;
}

export function PeopleTimelineTable({
	participantType,
	participantId,
	identityName,
	selectedProjectId,
	statusFilter,
	onStatusFilterChange,
	onCountChange,
	onAvailableCategoriesChange,
	onAvailablePayersChange,
	searchValue,
	onSearchChange,
	selectedCategories,
	paidByFilter,
	externalToolbar = false,
	onEdit,
	onDelete,
	onViewHistory,
}: PeopleTimelineTableProps) {
	const hideSettled = statusFilter === "active";
	const { formatCurrency } = useCurrencyFormatter();
	const isMobile = useIsMobile();

	// Selection state
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
	const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
	const [isBulkDeleting, setIsBulkDeleting] = useState(false);

	// Settlement action dialogs
	const [confirmingSettlementId, setConfirmingSettlementId] = useState<string | null>(null);
	const [rejectingSettlementId, setRejectingSettlementId] = useState<string | null>(null);
	const [deletingSettlementId, setDeletingSettlementId] = useState<string | null>(null);

	const timelineRowsRef = useRef<TimelineRow[]>([]);

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

	const handleSelectAll = useCallback((checked: boolean) => {
		if (checked) {
			setSelectedIds(
				new Set(
					timelineRowsRef.current
						.filter((r) => r.type === "transaction")
						.map((r) => r.id),
				),
			);
		} else {
			setSelectedIds(new Set());
		}
	}, []);

	const utils = api.useUtils();
	const bulkDeleteMutation = api.sharedTransaction.delete.useMutation();

	// Settlement action mutations
	const confirmSettlementMutation = api.settlement.confirm.useMutation({
		onSuccess: () => {
			toast.success("Settlement confirmed");
			invalidateAll();
			setConfirmingSettlementId(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const rejectSettlementMutation = api.settlement.reject.useMutation({
		onSuccess: () => {
			toast.success("Settlement rejected");
			invalidateAll();
			setRejectingSettlementId(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteSettlementMutation = api.settlement.deletePending.useMutation({
		onSuccess: () => {
			toast.success("Settlement cancelled");
			invalidateAll();
			setDeletingSettlementId(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const remindSettlementMutation = api.settlement.sendReminder.useMutation({
		onSuccess: () => toast.success("Reminder sent"),
		onError: (e) => toast.error(e.message),
	});

	const invalidateAll = () => {
		void utils.people.detailCursor.invalidate();
		void utils.people.detail.invalidate({ participantType, participantId });
		void utils.people.list.invalidate();
		void utils.settlement.history.invalidate();
		void utils.settlement.plan.invalidate();
	};

	const handleBulkDelete = async () => {
		setIsBulkDeleting(true);
		try {
			await Promise.all(
				Array.from(selectedIds).map((id) =>
					bulkDeleteMutation.mutateAsync({ id }),
				),
			);
			setSelectedIds(new Set());
			setShowBulkDeleteDialog(false);
			invalidateAll();
			toast.success("Expenses deleted");
		} catch {
			toast.error("Failed to delete some expenses");
		} finally {
			setIsBulkDeleting(false);
		}
	};

	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		api.people.detailCursor.useInfiniteQuery(
			{
				participantType,
				participantId,
				limit: 30,
			},
			{
				getNextPageParam: (lastPage) => lastPage.nextCursor,
			},
		);

	// Settlement history (single query, small dataset)
	const { data: settlementData } = api.settlement.history.useQuery(
		{ participantType, participantId },
		{ enabled: !isLoading },
	);

	// Flatten all transaction pages
	const allTransactions = useMemo(
		() => data?.pages.flatMap((p) => p.transactions) ?? [],
		[data],
	);

	// Build revision summaries query
	const txnIds = useMemo(
		() => allTransactions.map((t) => t.id),
		[allTransactions],
	);
	const { data: revisionSummaries } =
		api.auditLog.transactionRevisionSummary.useQuery(
			{ transactionIds: txnIds },
			{ enabled: txnIds.length > 0 },
		);

	// Derive available categories from all transactions (before filtering)
	const availableCategories = useMemo(() => {
		const map = new Map<string, AvailableCategory>();
		for (const t of allTransactions) {
			if (t.category) map.set(t.category.id, t.category);
		}
		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
	}, [allTransactions]);

	// Derive available payers (me + them) from all transactions
	const availablePayers = useMemo(() => {
		const payers: AvailablePayer[] = [];
		let hasMe = false;
		let hasThem = false;
		for (const t of allTransactions) {
			if (t.paidBy.isMe && !hasMe) {
				payers.push({ name: t.paidBy.name, avatarUrl: t.paidBy.avatarUrl, isMe: true });
				hasMe = true;
			} else if (!t.paidBy.isMe && !hasThem) {
				payers.push({ name: t.paidBy.name, avatarUrl: t.paidBy.avatarUrl, isMe: false });
				hasThem = true;
			}
			if (hasMe && hasThem) break;
		}
		// "Me" first
		return payers.sort((a, b) => (a.isMe === b.isMe ? 0 : a.isMe ? -1 : 1));
	}, [allTransactions]);

	// Notify parent of available categories and payers
	useEffect(() => {
		onAvailableCategoriesChange?.(availableCategories);
	}, [availableCategories, onAvailableCategoriesChange]);

	useEffect(() => {
		onAvailablePayersChange?.(availablePayers);
	}, [availablePayers, onAvailablePayersChange]);

	// Normalize transactions + settlements into TimelineRow[]
	const timelineRows = useMemo<TimelineRow[]>(() => {
		// Apply client-side filters: hide settled + project filter + category filter
		const filtered = allTransactions.filter((t) => {
			if (hideSettled && t.status === "settled") return false;
			if (selectedProjectId !== undefined) {
				if (selectedProjectId === null) {
					if (t.project !== null) return false;
				} else {
					if (t.project?.id !== selectedProjectId) return false;
				}
			}
			if (selectedCategories.size > 0) {
				if (!t.category || !selectedCategories.has(t.category.id)) return false;
			}
			if (paidByFilter === "me" && !t.paidBy.isMe) return false;
			if (paidByFilter === "them" && t.paidBy.isMe) return false;
			return true;
		});

		const txnRows: TimelineRow[] = filtered.map((t) => ({
			id: t.id,
			type: "transaction" as const,
			date: new Date(t.date),
			description: t.description,
			category: t.category,
			theirShare: t.theirShare,
			currency: t.currency,
			amount: t.amount,
			paidBy: t.paidBy,
			status: t.status,
			canEdit: t.canEdit,
			canDelete: t.canDelete,
			hasUnseenChanges: t.hasUnseenChanges,
			project: t.project,
		}));

		// Only include settlements when no project filter is active
		const settlementRows: TimelineRow[] =
			selectedProjectId === undefined
				? (settlementData ?? []).map((s) => ({
						id: `settlement-${s.id}`,
						type: "settlement" as const,
						date: new Date(s.initiatedAt),
						currency: s.currency,
						amount: s.amount,
						status: s.status,
						direction: s.direction,
						settlementId: s.id,
						paymentMethod: s.paymentMethod,
						note: s.note,
						canConfirmSettlement: s.canConfirm,
						canRejectSettlement: s.canReject,
						canDeleteSettlement: s.canDelete,
						canRemindSettlement: s.canRemind,
					}))
				: [];

		const rows = [...txnRows, ...settlementRows];
		timelineRowsRef.current = rows;
		return rows;
	}, [allTransactions, settlementData, hideSettled, selectedProjectId, selectedCategories, paidByFilter]);

	const txnCount = useMemo(
		() => timelineRows.filter((r) => r.type === "transaction").length,
		[timelineRows],
	);

	useEffect(() => {
		onCountChange?.(txnCount);
	}, [txnCount, onCountChange]);

	const columns = useMemo(
		() =>
			createTimelineColumns(
				formatCurrency,
				identityName,
				{
					onEdit,
					onDelete,
					onViewHistory,
					onConfirmSettlement: (id) => setConfirmingSettlementId(id),
					onRejectSettlement: (id) => setRejectingSettlementId(id),
					onDeleteSettlement: (id) => setDeletingSettlementId(id),
					onRemindSettlement: (id) => {
						remindSettlementMutation.mutate({ id });
					},
				},
				revisionSummaries ?? undefined,
			),
		[
			formatCurrency,
			identityName,
			onEdit,
			onDelete,
			onViewHistory,
			revisionSummaries,
			remindSettlementMutation,
		],
	);

	const columnVisibility = useMemo<VisibilityState>(
		() => ({
			category: !isMobile,
			paidBy: !isMobile,
			status: !isMobile,
		}),
		[isMobile],
	);

	const rowClassName = useMemo(
		() => (row: Row<TimelineRow>) => {
			const item = row.original;
			if (item.status === "settled") {
				return "opacity-60";
			}
			return undefined;
		},
		[],
	);

	const renderContextMenu = useMemo(
		() => (row: TimelineRow) => {
			if (row.type === "settlement") return null;
			return (
				<>
					<ContextMenuItem onClick={() => onViewHistory(row.id)}>
						<History className="mr-2 h-4 w-4" />
						View history
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						disabled={!row.canEdit || row.status === "settled"}
						onClick={() => onEdit(row.id)}
					>
						<Edit2 className="mr-2 h-4 w-4" />
						Edit
					</ContextMenuItem>
					<ContextMenuItem
						disabled={!row.canDelete || row.status === "settled"}
						onClick={() =>
							onDelete({
								id: row.id,
								description: row.description ?? "",
								amount: row.amount ?? 0,
								currency: row.currency,
								date: new Date(row.date),
							})
						}
						variant="destructive"
					>
						<Trash2 className="mr-2 h-4 w-4" />
						Delete
					</ContextMenuItem>
				</>
			);
		},
		[onEdit, onDelete, onViewHistory],
	);

	if (isLoading) {
		return (
			<div className="space-y-2">
				{[...Array(4)].map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
					<Skeleton className="h-12 w-full" key={i} />
				))}
			</div>
		);
	}

	const hasActiveFilters = selectedCategories.size > 0 || paidByFilter !== "all" || searchValue.length > 0;

	if (timelineRows.length === 0 && !hasActiveFilters) {
		return (
			<div className="rounded-xl border border-border border-dashed">
				<EmptyState
					description={
						hideSettled
							? 'Switch to "All" to see settled transactions.'
							: "Shared expenses with this person will appear here."
					}
					icon={Users}
					title={
						hideSettled
							? "No Active Transactions"
							: "No Shared Transactions Yet"
					}
				/>
			</div>
		);
	}

	const statusToggle = (
		<div className="flex rounded-lg border border-border p-0.5">
			{(["all", "active"] as const).map((filter) => (
				<button
					className={cn(
						"cursor-pointer rounded-md px-2.5 py-1 font-medium text-xs transition-colors",
						statusFilter === filter
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
					key={filter}
					onClick={() => onStatusFilterChange(filter)}
					type="button"
				>
					{filter === "all" ? "All" : "Outstanding"}
				</button>
			))}
		</div>
	);

	return (
		<>
			<DataTable
				columns={columns}
				columnVisibility={columnVisibility}
				countExtra={
					externalToolbar ? undefined : (
						<div className="flex items-center gap-2">
							<span className="shrink-0 text-muted-foreground text-sm">
								{txnCount}{" "}
								{txnCount === 1 ? "expense" : "expenses"}
							</span>
							{statusToggle}
						</div>
					)
				}
				data={timelineRows}
				hideCount={true}
				emptyState={
					<div className="py-8 text-muted-foreground text-sm">
						No matching expenses.
					</div>
				}
				initialSorting={[{ id: "date", desc: true }]}
				isRowSelectable={(row) => row.type === "transaction"}
				lastSelectedId={lastSelectedId}
				onClearSelection={() => handleSelectAll(false)}
				onRangeSelect={handleRangeSelect}
				onReachEnd={() => {
					if (hasNextPage && !isFetchingNextPage) fetchNextPage();
				}}
				onRowSelect={handleRowSelect}
				progressive
				renderContextMenu={renderContextMenu}
				renderToolbar={(_table, headerHeight) => (
					<DataTableSelectionBar
						headerHeight={headerHeight}
						onDeleteSelected={() => setShowBulkDeleteDialog(true)}
						onEditSelected={
							selectedIds.size === 1 ? (id) => onEdit(id) : undefined
						}
						onSelectAll={handleSelectAll}
						selectedRows={selectedIds}
					/>
				)}
				rowClassName={rowClassName}
				searchValue={searchValue}
				onSearchChange={onSearchChange}
				searchable={false}
				selectedRows={selectedIds}
			/>

			{/* Bulk delete dialog */}
			<ConfirmDialog
				confirmText="Delete"
				description={`Delete ${selectedIds.size} expense${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`}
				isLoading={isBulkDeleting}
				onConfirm={handleBulkDelete}
				onOpenChange={(open) => {
					if (!open) setShowBulkDeleteDialog(false);
				}}
				open={showBulkDeleteDialog}
				title="Delete selected expenses?"
				variant="destructive"
			/>

			{/* Confirm settlement dialog */}
			<ConfirmDialog
				confirmText="Confirm"
				description="Confirm that you received this payment? This cannot be undone."
				isLoading={confirmSettlementMutation.isPending}
				onConfirm={() => {
					if (confirmingSettlementId) {
						confirmSettlementMutation.mutate({ id: confirmingSettlementId });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setConfirmingSettlementId(null);
				}}
				open={!!confirmingSettlementId}
				title="Confirm settlement?"
			/>

			{/* Reject settlement dialog */}
			<ConfirmDialog
				confirmText="Reject"
				description="Reject this settlement? The payer will be notified."
				isLoading={rejectSettlementMutation.isPending}
				onConfirm={() => {
					if (rejectingSettlementId) {
						rejectSettlementMutation.mutate({ id: rejectingSettlementId });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setRejectingSettlementId(null);
				}}
				open={!!rejectingSettlementId}
				title="Reject settlement?"
				variant="destructive"
			/>

			{/* Cancel settlement dialog */}
			<ConfirmDialog
				confirmText="Cancel Settlement"
				description="Cancel this pending settlement? This will remove it entirely."
				isLoading={deleteSettlementMutation.isPending}
				onConfirm={() => {
					if (deletingSettlementId) {
						deleteSettlementMutation.mutate({ id: deletingSettlementId });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setDeletingSettlementId(null);
				}}
				open={!!deletingSettlementId}
				title="Cancel settlement?"
				variant="destructive"
			/>
		</>
	);
}

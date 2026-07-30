import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";

/**
 * A row is bulk-deletable through this hook only when it is a personal
 * expense the caller owns. Shared rows are excluded: they are identified by a
 * synthetic `shared:<txnId>` id and can only be removed via the dedicated
 * `sharedTransaction.delete` / `verification.removeSelf` flows (which are
 * permission-gated elsewhere). Firing `expense.deleteExpense` on a shared id
 * would always be rejected server-side, so we must never offer it here.
 */
function isBulkDeletable(row: { source?: "personal" | "shared" }): boolean {
	return row.source !== "shared";
}

/**
 * useTableActions - Headless hook for managing table actions and mutations
 *
 * Handles:
 * - Row selection state
 * - Bulk actions (export, delete)
 * - Confirmation dialog state
 * - Mutation execution
 */
export function useTableActions<
	T extends { id: string; source?: "personal" | "shared" },
>(filteredData: T[], onDataChanged?: () => void) {
	// Selection State
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

	// Ref so handleSelectAll never needs to be recreated when filteredData changes
	const filteredDataRef = useRef(filteredData);
	filteredDataRef.current = filteredData;

	// Mutations
	const deleteExpenseMutation = api.expense.deleteExpense.useMutation();
	const exportMutation = api.expense.exportCsv.useMutation();

	// Selection Handlers
	const handleRowSelect = useCallback((id: string, checked: boolean) => {
		setSelectedIds((prev) => {
			const newSet = new Set(prev);
			if (checked) {
				newSet.add(id);
			} else {
				newSet.delete(id);
			}
			return newSet;
		});
		if (checked) setLastSelectedId(id);
	}, []);

	const handleRangeSelect = useCallback((ids: string[]) => {
		setSelectedIds((prev) => {
			const newSet = new Set(prev);
			for (const id of ids) {
				newSet.add(id);
			}
			return newSet;
		});
		if (ids.length > 0) setLastSelectedId(ids[ids.length - 1]!);
	}, []);

	// Stable reference: reads filteredDataRef.current so the function identity
	// never changes when filters change, preventing columns from being recreated.
	const handleSelectAll = useCallback((checked: boolean) => {
		if (checked) {
			setSelectedIds(new Set(filteredDataRef.current.map((e) => e.id)));
		} else {
			setSelectedIds(new Set());
		}
	}, []);

	// Cleanup selection if items are filtered out/deleted
	useEffect(() => {
		if (selectedIds.size === 0) return;
		const visibleIds = new Set(filteredData.map((e) => e.id));
		const newSelected = new Set<string>();
		let hasChanges = false;
		for (const id of selectedIds) {
			if (visibleIds.has(id)) {
				newSelected.add(id);
			} else {
				hasChanges = true;
			}
		}
		if (hasChanges) {
			setSelectedIds(newSelected);
		}
	}, [filteredData, selectedIds]);

	// Action Handlers
	const handleExportSelected = async () => {
		try {
			const expenseIds = Array.from(selectedIds);
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

	// The subset of the current selection that this bulk path is actually
	// allowed to delete (personal expenses only). Everything else — shared
	// rows the user can't delete this way — is skipped so we never trigger a
	// mutation the server will reject.
	const deletableSelectedIds = useMemo(() => {
		const deletable = new Set(
			filteredData.filter(isBulkDeletable).map((r) => r.id),
		);
		return Array.from(selectedIds).filter((id) => deletable.has(id));
	}, [filteredData, selectedIds]);

	const handleDeleteSelected = () => {
		// Inert affordance when nothing in the selection is deletable here.
		if (deletableSelectedIds.length === 0) return;
		setShowDeleteDialog(true);
	};

	const confirmDelete = async () => {
		if (deletableSelectedIds.length === 0) {
			setShowDeleteDialog(false);
			return;
		}
		try {
			await Promise.all(
				deletableSelectedIds.map((id) =>
					deleteExpenseMutation.mutateAsync({ id }),
				),
			);

			setSelectedIds(new Set());
			setShowDeleteDialog(false);
			onDataChanged?.();
			toast.success("Expenses deleted successfully");
		} catch (_error) {
			toast.error("Failed to delete some expenses. Please try again.");
		}
	};

	return {
		// State
		selectedIds,
		// Count of selected rows this bulk path will actually delete (personal
		// only). Used so the confirmation dialog never promises to delete rows
		// it will skip.
		deletableSelectedCount: deletableSelectedIds.length,
		showDeleteDialog,
		isDeleting: deleteExpenseMutation.isPending,
		isExporting: exportMutation.isPending,

		// State Setters (if needed directly)
		setShowDeleteDialog,
		setSelectedIds,
		lastSelectedId,

		// Handlers
		handleRowSelect,
		handleSelectAll,
		handleRangeSelect,
		handleExportSelected,
		handleDeleteSelected,
		confirmDelete,
	};
}

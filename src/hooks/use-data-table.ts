"use client";

import {
	type ColumnDef,
	type ColumnFiltersState,
	type PaginationState,
	type RowSelectionState,
	type SortingState,
	type VisibilityState,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";

interface UseDataTableProps<TData> {
	data: TData[];
	columns: ColumnDef<TData>[];
	initialSorting?: SortingState;
	pageSize?: number;
	// Support controlled selection if needed
	rowSelection?: RowSelectionState;
	onRowSelectionChange?: (updaterOrValue: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => void;
}

/**
 * useDataTable - A headless hook for TanStack Table state management.
 * Centralizes sorting, pagination, selection, and visibility logic.
 */
export function useDataTable<TData>({
	data,
	columns,
	initialSorting = [],
	pageSize = 15,
	rowSelection: controlledRowSelection,
	onRowSelectionChange: setControlledRowSelection,
}: UseDataTableProps<TData>) {
	const [sorting, setSorting] = useState<SortingState>(initialSorting);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize,
	});

	const rowSelection = controlledRowSelection ?? internalRowSelection;
	const onRowSelectionChange = setControlledRowSelection ?? setInternalRowSelection;

	const table = useReactTable({
		data,
		columns,
		state: {
			sorting,
			columnVisibility,
			rowSelection,
			columnFilters,
			pagination,
		},
		enableRowSelection: true,
		onSortingChange: setSorting,
		onColumnVisibilityChange: setColumnVisibility,
		onColumnFiltersChange: setColumnFilters,
		onRowSelectionChange,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		// Default to using 'id' property for row identification if it exists
		getRowId: (row) => (row as { id?: string }).id ?? "0",
	});

	return {
		table,
		rowSelection,
	};
}

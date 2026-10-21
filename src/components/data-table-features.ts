import {
	type CellData,
	type ColumnDef,
	columnFilteringFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	createExpandedRowModel,
	createFilteredRowModel,
	createPaginatedRowModel,
	createSortedRowModel,
	globalFilteringFeature,
	type ReactTable,
	type Row,
	type RowData,
	rowExpandingFeature,
	rowPaginationFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_basic,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";

/**
 * Feature set shared by every DataTable in the app (TanStack Table v9 needs
 * features registered up front). Covers what the v8 tables relied on:
 * sorting, global search, column visibility and sizing, expandable sub-rows
 * and optional client-side pagination.
 */
export const dataTableFeatures = tableFeatures({
	columnFilteringFeature,
	globalFilteringFeature,
	columnVisibilityFeature,
	columnSizingFeature,
	rowSortingFeature,
	rowExpandingFeature,
	rowPaginationFeature,
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	expandedRowModel: createExpandedRowModel(),
	paginatedRowModel: createPaginatedRowModel(),
	// Built-ins reachable from column defs: explicit "datetime" plus the
	// names the "auto" sort resolves to.
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		basic: sortFn_basic,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

export type DataTableFeatures = typeof dataTableFeatures;

/** Rows rendered by DataTable are keyed by their own id. */
export type DataTableRowData = RowData & { id: string };

export type DataTableColumnDef<
	TData extends RowData,
	TValue extends CellData = CellData,
> = ColumnDef<DataTableFeatures, TData, TValue>;

export type DataTableRow<TData extends RowData> = Row<DataTableFeatures, TData>;

export type DataTableInstance<TData extends RowData> = ReactTable<
	DataTableFeatures,
	TData
>;

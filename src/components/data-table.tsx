"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import {
	type ColumnDef,
	type ExpandedState,
	flexRender,
	getCoreRowModel,
	getExpandedRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	type Table as TableType,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import * as React from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";
import { TablePagination } from "./table-pagination";
import { ExpandableSearch } from "./table-search";

const PROGRESSIVE_THRESHOLD = 200;
const PROGRESSIVE_BATCH = 100;

// ---- Memoized row ----

interface DataRowProps<TData extends { id: string }> {
	row: Row<TData>;
	/** Number of visible columns - busts memo when column visibility changes */
	cellCount: number;
	/** Increments when column definitions change - busts memo when cell renderers change */
	columnsVersion: number;
	isSelected: boolean;
	isSelectable: boolean;
	isInPreview: boolean;
	hasSelectionMode: boolean;
	hasClickHandler: boolean;
	/** Stable ref-backed callback - excluded from memo comparison by design */
	onAction: (rowId: string, shifted: boolean) => void;
	/** Stable ref-backed callback - excluded from memo comparison by design */
	onMouseEnter: (rowId: string) => void;
	/** Stable ref-backed callback - excluded from memo comparison by design */
	onMouseLeave: () => void;
	/** Stable ref-backed callback - excluded from memo comparison by design */
	renderContextMenu?: ((row: TData) => React.ReactNode) | null;
	/** Additional CSS class for this row */
	rowExtraClassName?: string;
}

function DataRowInner<TData extends { id: string }>({
	row,
	isSelected,
	isSelectable,
	isInPreview,
	hasSelectionMode,
	hasClickHandler,
	onAction,
	onMouseEnter,
	onMouseLeave,
	renderContextMenu,
	rowExtraClassName,
}: DataRowProps<TData>) {
	const tableRow = (
		<TableRow
			className={cn(
				"group",
				hasSelectionMode && isSelectable && "cursor-pointer",
				!hasSelectionMode &&
					hasClickHandler &&
					"cursor-pointer transition-colors",
				hasSelectionMode &&
					!isSelectable &&
					hasClickHandler &&
					"cursor-pointer",
				isInPreview && "bg-muted/30",
				rowExtraClassName,
			)}
			data-state={isSelected ? "selected" : undefined}
			onClick={(e) => {
				const target = e.target as HTMLElement;
				if (
					target.closest(
						'button, a, input, select, textarea, [role="checkbox"]',
					)
				)
					return;
				onAction(row.original.id, e.shiftKey);
			}}
			onMouseEnter={
				hasSelectionMode ? () => onMouseEnter(row.original.id) : undefined
			}
			onMouseLeave={hasSelectionMode ? onMouseLeave : undefined}
		>
			{row.getVisibleCells().map((cell) => {
				const meta = cell.column.columnDef.meta as Record<string, unknown> | undefined;
				return (
					<TableCell
						className={(meta?.className as string) ?? undefined}
						key={cell.id}
						style={
							cell.column.columnDef.size != null && !meta?.flex
								? {
										width: cell.column.getSize(),
										minWidth: cell.column.getSize(),
									}
								: undefined
						}
					>
						<div className="flex min-h-7 items-center">
							{flexRender(cell.column.columnDef.cell, cell.getContext())}
						</div>
					</TableCell>
				);
			})}
		</TableRow>
	);

	if (!renderContextMenu) return tableRow;

	const contextContent = renderContextMenu(row.original);
	if (!contextContent) return tableRow;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{tableRow}</ContextMenuTrigger>
			<ContextMenuContent>{contextContent}</ContextMenuContent>
		</ContextMenu>
	);
}

/**
 * Re-renders only when the row's underlying data, column count, or
 * selection/preview state changes. Stable callback props are intentionally
 * excluded from the comparison - they are backed by refs and never change identity.
 */
const MemoizedDataRow = React.memo(
	DataRowInner,
	(prev, next) =>
		prev.row.original === next.row.original &&
		prev.cellCount === next.cellCount &&
		prev.columnsVersion === next.columnsVersion &&
		prev.isSelected === next.isSelected &&
		prev.isInPreview === next.isInPreview &&
		prev.isSelectable === next.isSelectable &&
		prev.rowExtraClassName === next.rowExtraClassName,
) as typeof DataRowInner;

interface PaginationConfig {
	defaultPageSize?: number;
	pageSizeOptions?: number[];
}

interface DataTableProps<TData> {
	data: TData[];
	columns: ColumnDef<TData>[];
	onRowClick?: (row: TData) => void;
	searchPlaceholder?: string;
	emptyState?: React.ReactNode;
	renderToolbar?: (
		table: TableType<TData>,
		headerHeight: string,
	) => React.ReactNode;
	/** Static footer node, or a function receiving the currently visible rows */
	footer?: React.ReactNode | ((filteredRows: TData[]) => React.ReactNode);
	initialSorting?: SortingState;
	/** @deprecated pagination removed; prop kept for API compatibility */
	pageSize?: number;
	/** Columns to hide: keys must match column id/accessorKey */
	columnVisibility?: VisibilityState;
	/** Render context menu items for a row (shown on right-click) */
	renderContextMenu?: (row: TData) => React.ReactNode;
	/** Set of selected row IDs for click-to-select behavior */
	selectedRows?: Set<string>;
	/** Callback when a single row is selected/deselected via click */
	onRowSelect?: (id: string, checked: boolean) => void;
	/** Callback for shift+click range selection */
	onRangeSelect?: (ids: string[]) => void;
	/** Predicate to determine if a row can be selected (default: all selectable) */
	isRowSelectable?: (row: TData) => boolean;
	/** ID of the last selected row, used as anchor for shift+click */
	lastSelectedId?: string | null;
	/** Callback to clear all selections (triggered by Escape key) */
	onClearSelection?: () => void;
	/** When true, the table expands to fill available height instead of capping at max-h */
	fillHeight?: boolean;
	/**
	 * Total row count BEFORE text-search filtering (i.e. after external filters).
	 * When provided, the count indicator shows "X of Y <countNoun>" when a search
	 * is active that reduces the visible set.
	 */
	totalCount?: number;
	/** Singular/plural label used in the count indicator (default: "items") */
	countNoun?: string;
	/**
	 * When provided, the search state is controlled externally.
	 * The internal search bar is hidden and this value is used as the global filter.
	 */
	searchValue?: string;
	/** Setter for controlled search — required when searchValue is provided */
	onSearchChange?: (value: string) => void;
	/**
	 * Called whenever the post-search filtered row count changes.
	 * Useful when search is controlled externally and the parent needs the live count.
	 */
	onFilteredCountChange?: (count: number) => void;
	/**
	 * Enable progressive (infinite-scroll) rendering for large datasets.
	 * When true, rows are rendered in batches as the user scrolls.
	 * Default: false
	 */
	progressive?: boolean;
	/**
	 * Enable pagination. Pass `true` for defaults (page size 20, options [10, 20, 30, 50]),
	 * or an object to customize `defaultPageSize` and `pageSizeOptions`.
	 * Mutually exclusive with `progressive` - pagination takes precedence.
	 * Default: false
	 */
	pagination?: boolean | PaginationConfig;
	/**
	 * Show the search bar above the table.
	 * Default: true
	 */
	searchable?: boolean;
	/** Hide the built-in count indicator (useful when the parent renders its own) */
	hideCount?: boolean;
	/** Extra node rendered to the right of the count indicator */
	countExtra?: React.ReactNode;
	/**
	 * Custom row renderer. When provided, bypasses MemoizedDataRow.
	 * Consumer must render TableRow + cells.
	 */
	renderRow?: (row: Row<TData>) => React.ReactNode;
	/**
	 * Wraps the content inside <TableBody>. Useful for DndContext/SortableContext.
	 */
	renderTableBodyContent?: (children: React.ReactNode) => React.ReactNode;
	/**
	 * Sub-row accessor for expandable/grouped rows.
	 * When provided, enables getExpandedRowModel().
	 */
	getSubRows?: (row: TData) => TData[] | undefined;
	/**
	 * Return additional CSS class names for a row based on its data.
	 * Merged with existing row classes.
	 */
	rowClassName?: (row: Row<TData>) => string | undefined;
	/**
	 * Called when progressive rendering has rendered all loaded rows and the
	 * scroll sentinel fires. Useful for triggering `fetchNextPage` in
	 * server-paginated infinite-scroll tables.
	 */
	onReachEnd?: () => void;
	/** Called when Delete/Backspace is pressed with selected rows */
	onDeleteSelected?: () => void;
	/** Called when E/Enter is pressed with exactly one selected row */
	onEditRow?: (id: string) => void;
}

/**
 * A generic, presentational data table component.
 * Handles search, sorting, and rendering internally.
 * Toolbars (selection bars) and footers are delegated to the parent.
 */
export function DataTable<TData extends { id: string }>({
	data,
	columns,
	onRowClick,
	searchPlaceholder = "Search...",
	emptyState,
	renderToolbar,
	footer,
	initialSorting = [],
	columnVisibility = {} as VisibilityState,
	renderContextMenu,
	selectedRows,
	onRowSelect,
	onRangeSelect,
	isRowSelectable,
	lastSelectedId,
	onClearSelection,
	fillHeight,
	totalCount,
	countNoun = "items",
	progressive = false,
	pagination: paginationProp = false,
	searchable = true,
	hideCount = false,
	renderRow,
	renderTableBodyContent,
	getSubRows,
	rowClassName,
	searchValue,
	onSearchChange,
	onFilteredCountChange,
	onReachEnd,
	countExtra,
	onDeleteSelected,
	onEditRow,
}: DataTableProps<TData>) {
	const isControlledSearch = searchValue !== undefined;
	const [searchInput, setSearchInput] = React.useState("");
	const activeSearch = isControlledSearch ? searchValue : searchInput;
	const deferredSearch = React.useDeferredValue(activeSearch);

	const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
	const [expanded, setExpanded] = React.useState<ExpandedState>({});

	// Progressive rendering state
	const [renderedCount, setRenderedCount] = React.useState(
		PROGRESSIVE_THRESHOLD,
	);
	const scrollContainerRef = React.useRef<HTMLDivElement>(null);
	const sentinelRef = React.useRef<HTMLDivElement>(null);

	// Resolve pagination config
	const paginationEnabled = paginationProp !== false;
	const paginationConfig: PaginationConfig | null = paginationEnabled
		? paginationProp === true
			? { defaultPageSize: 20, pageSizeOptions: [10, 20, 30, 50] }
			: paginationProp
		: null;

	const table = useReactTable({
		data,
		columns,
		// Stable row identity based on the record's own ID rather than array index.
		// Without this, TanStack uses index-based IDs ("0", "1", …) which causes
		// it to reconstruct row state when the data array shrinks/grows after a filter.
		getRowId: (row) => row.id,
		state: {
			sorting,
			globalFilter: deferredSearch,
			columnVisibility,
			...(getSubRows ? { expanded } : {}),
		},
		onSortingChange: setSorting,
		onGlobalFilterChange: (value) => {
			if (isControlledSearch) {
				onSearchChange?.(value ?? "");
			} else {
				setSearchInput(value ?? "");
			}
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		...(getSubRows
			? {
					getExpandedRowModel: getExpandedRowModel(),
					getSubRows,
					onExpandedChange: setExpanded,
				}
			: {}),
		...(paginationEnabled
			? {
					getPaginationRowModel: getPaginationRowModel(),
					initialState: {
						pagination: {
							pageSize: paginationConfig?.defaultPageSize ?? 20,
						},
					},
				}
			: {}),
	});

	// All rows after filtering + sorting
	// When pagination is enabled, use the paginated row model for display
	const allFilteredRows = table.getFilteredRowModel().rows;
	const rows = paginationEnabled
		? table.getPaginationRowModel().rows
		: table.getRowModel().rows;

	// Scroll to top and reset progressive rendering when external data changes
	React.useEffect(() => {
		if (progressive) {
			setRenderedCount(PROGRESSIVE_THRESHOLD);
		}
		scrollContainerRef.current?.scrollTo({ top: 0 });
	}, [data, progressive]);

	// Also reset when search changes (so "scroll to top" works on filter change)
	React.useEffect(() => {
		scrollContainerRef.current?.scrollTo({ top: 0 });
	}, [deferredSearch]);

	// Ref for onReachEnd to avoid re-creating the observer
	const onReachEndRef = React.useRef(onReachEnd);
	onReachEndRef.current = onReachEnd;

	// Progressive rendering via IntersectionObserver on the sentinel element
	React.useEffect(() => {
		if (!progressive) return;
		const sentinel = sentinelRef.current;
		const container = scrollContainerRef.current;
		if (!sentinel || !container) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					setRenderedCount((c) => {
						const next = c + PROGRESSIVE_BATCH;
						// If we've rendered all loaded rows, notify the parent
						if (next >= rows.length) {
							onReachEndRef.current?.();
						}
						return next;
					});
				}
			},
			{ root: container, rootMargin: "300px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [progressive, data, rows.length]);

	// Rows to actually render (sliced for progressive rendering, or all)
	const visibleRows =
		progressive && rows.length > PROGRESSIVE_THRESHOLD
			? rows.slice(0, renderedCount)
			: rows;
	const hasMoreRows = progressive && rows.length > renderedCount;

	// --- Click-to-select & shift+click range selection ---
	const hasSelectionMode = !!onRowSelect;
	const hasSelection = (selectedRows?.size ?? 0) > 0;

	// Keep a ref to visibleRows so the keydown handler always sees fresh data
	const visibleRowsRef = React.useRef(visibleRows);
	visibleRowsRef.current = visibleRows;

	// Refs for stable callback props - updated synchronously each render
	const selectedRowsRef = React.useRef(selectedRows);
	selectedRowsRef.current = selectedRows;
	const lastSelectedIdRef = React.useRef(lastSelectedId);
	lastSelectedIdRef.current = lastSelectedId;
	const onRowSelectRef = React.useRef(onRowSelect);
	onRowSelectRef.current = onRowSelect;
	const onRangeSelectRef = React.useRef(onRangeSelect);
	onRangeSelectRef.current = onRangeSelect;
	const isRowSelectableRef = React.useRef(isRowSelectable);
	isRowSelectableRef.current = isRowSelectable;
	const onRowClickRef = React.useRef(onRowClick);
	onRowClickRef.current = onRowClick;
	const renderContextMenuRef = React.useRef(renderContextMenu);
	renderContextMenuRef.current = renderContextMenu;
	const rowClassNameRef = React.useRef(rowClassName);
	rowClassNameRef.current = rowClassName;
	const onDeleteSelectedRef = React.useRef(onDeleteSelected);
	onDeleteSelectedRef.current = onDeleteSelected;
	const onEditRowRef = React.useRef(onEditRow);
	onEditRowRef.current = onEditRow;
	// Track shift state in a ref so stable callbacks can read it without deps
	const isShiftHeldRef = React.useRef(false);

	// Track shift key for range selection preview
	const [isShiftHeld, setIsShiftHeld] = React.useState(false);
	// Use a ref to track hovered row without causing renders; only force-render
	// when shift is held (so preview range reacts to mouse movement).
	const hoveredRowIndexRef = React.useRef<number | null>(null);
	const [, forcePreviewUpdate] = React.useReducer((x: number) => x + 1, 0);

	React.useEffect(() => {
		if (!hasSelectionMode) return;

		const isEditable = (el: HTMLElement) => {
			const tag = el.tagName;
			return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
		};
		const hasDialog = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Shift") {
				isShiftHeldRef.current = true;
				setIsShiftHeld(true);
			}

			// Escape — clear selection (skip if dialog open or input focused)
			if (e.key === "Escape" && selectedRows && selectedRows.size > 0 && onClearSelection) {
				if (hasDialog()) return;
				if (isEditable(e.target as HTMLElement)) return;
				onClearSelection();
			}

			// Cmd/Ctrl+A — select all
			if (e.key === "a" && (e.ctrlKey || e.metaKey) && onRangeSelect) {
				if (isEditable(e.target as HTMLElement)) return;
				e.preventDefault();
				const selectableIds = visibleRowsRef.current
					.filter((r) => (isRowSelectable ? isRowSelectable(r.original) : true))
					.map((r) => r.original.id);
				if (selectableIds.length > 0) onRangeSelect(selectableIds);
			}

			// E or Enter — edit single selected row
			if (
				(e.key === "e" || e.key === "E" || e.key === "Enter") &&
				!e.ctrlKey && !e.metaKey && !e.altKey &&
				selectedRows?.size === 1 &&
				onEditRowRef.current
			) {
				if (hasDialog()) return;
				const el = e.target as HTMLElement;
				if (isEditable(el) || el.closest("button, a, [role=\"button\"]")) return;
				e.preventDefault();
				const id = Array.from(selectedRows)[0]!;
				onEditRowRef.current(id);
			}

			// Delete / Backspace — delete selected rows
			if (
				(e.key === "Delete" || e.key === "Backspace") &&
				selectedRows && selectedRows.size > 0 &&
				onDeleteSelectedRef.current
			) {
				if (hasDialog()) return;
				if (isEditable(e.target as HTMLElement)) return;
				e.preventDefault();
				onDeleteSelectedRef.current();
			}
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Shift") {
				isShiftHeldRef.current = false;
				setIsShiftHeld(false);
			}
		};
		const onBlur = () => {
			isShiftHeldRef.current = false;
			setIsShiftHeld(false);
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
		};
	}, [
		hasSelectionMode,
		selectedRows,
		onClearSelection,
		onRangeSelect,
		isRowSelectable,
	]);

	// Prevent text selection while shift-dragging
	React.useEffect(() => {
		if (!isShiftHeld || !hasSelectionMode) return;
		const handler = (e: Event) => e.preventDefault();
		document.addEventListener("selectstart", handler);
		return () => document.removeEventListener("selectstart", handler);
	}, [isShiftHeld, hasSelectionMode]);

	// Convert lastSelectedId to a row index within the visible rows
	const lastSelectedIndex = React.useMemo(() => {
		if (!lastSelectedId) return null;
		const idx = visibleRows.findIndex((r) => r.original.id === lastSelectedId);
		return idx >= 0 ? idx : null;
	}, [lastSelectedId, visibleRows]);

	// When shift becomes held, force a render so the preview range appears
	// immediately at the current hovered row without waiting for a mousemove.
	React.useEffect(() => {
		if (isShiftHeld) forcePreviewUpdate();
	}, [isShiftHeld]);

	// Shift+hover preview range - reads from ref so hover events don't cause
	// re-renders unless shift is held.
	const hoveredRowIndex = hoveredRowIndexRef.current;
	const previewRange =
		isShiftHeld && lastSelectedIndex !== null && hoveredRowIndex !== null
			? {
					start: Math.min(lastSelectedIndex, hoveredRowIndex),
					end: Math.max(lastSelectedIndex, hoveredRowIndex),
				}
			: null;

	// Stable callbacks - identity never changes across renders; latest prop values
	// are always available via the refs updated above.
	const stableOnAction = React.useCallback(
		(rowId: string, shifted: boolean) => {
			const currentRows = visibleRowsRef.current;
			const rowIndex = currentRows.findIndex((r) => r.original.id === rowId);
			if (rowIndex === -1) return;
			const row = currentRows[rowIndex]!;
			const rowIsSelectable = isRowSelectableRef.current
				? isRowSelectableRef.current(row.original)
				: true;
			if (onRowSelectRef.current && rowIsSelectable) {
				if (shifted) {
					const lastId = lastSelectedIdRef.current;
					const lastIdx = lastId
						? currentRows.findIndex((r) => r.original.id === lastId)
						: -1;
					if (lastIdx !== -1 && onRangeSelectRef.current) {
						const start = Math.min(lastIdx, rowIndex);
						const end = Math.max(lastIdx, rowIndex);
						const ids = currentRows
							.slice(start, end + 1)
							.filter((r) =>
								isRowSelectableRef.current
									? isRowSelectableRef.current(r.original)
									: true,
							)
							.map((r) => r.original.id);
						onRangeSelectRef.current(ids);
						return;
					}
				}
				const isSelected = selectedRowsRef.current?.has(rowId) ?? false;
				onRowSelectRef.current(rowId, !isSelected);
			} else {
				onRowClickRef.current?.(row.original);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	const stableOnMouseEnter = React.useCallback((rowId: string) => {
		const idx = visibleRowsRef.current.findIndex(
			(r) => r.original.id === rowId,
		);
		hoveredRowIndexRef.current = idx >= 0 ? idx : null;
		if (isShiftHeldRef.current) forcePreviewUpdate();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const stableOnMouseLeave = React.useCallback(() => {
		hoveredRowIndexRef.current = null;
		if (isShiftHeldRef.current) forcePreviewUpdate();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const stableRenderContextMenu = React.useCallback(
		(row: TData) => renderContextMenuRef.current?.(row) ?? null,
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	// Number of visible columns - tells MemoizedDataRow when column layout changes
	const cellCount = table.getVisibleLeafColumns().length;

	// Track columns version so MemoizedDataRow re-renders when cell renderers change
	// (e.g. when a privacy mode flag is toggled and columns are recreated)
	const columnsVersionRef = React.useRef(0);
	const prevColumnsRef = React.useRef(columns);
	if (prevColumnsRef.current !== columns) {
		columnsVersionRef.current += 1;
		prevColumnsRef.current = columns;
	}
	const columnsVersion = columnsVersionRef.current;

	// Ref to measure header height for precise overlay (used by toolbars/selection bars)
	const headerRef = React.useRef<HTMLTableSectionElement>(null);
	const [headerHeight, setHeaderHeight] = React.useState("0px");
	const [colWidths, setColWidths] = React.useState<number[]>([]);

	React.useLayoutEffect(() => {
		const headerElement = headerRef.current;
		if (!headerElement) return;

		const updateHeight = () => {
			setHeaderHeight(`${headerElement.offsetHeight}px`);
			const firstRow = headerElement.querySelector("tr");
			if (firstRow) {
				setColWidths(
					Array.from(firstRow.children).map(
						(th) => (th as HTMLElement).getBoundingClientRect().width,
					),
				);
			}
		};

		updateHeight();
		const observer = new ResizeObserver(updateHeight);
		observer.observe(headerElement);

		return () => observer.disconnect();
	}, []);

	// For count label, use all filtered rows (not paginated) when pagination is on
	const displayedCount = paginationEnabled
		? allFilteredRows.length
		: rows.length;
	const isTextSearchActive = deferredSearch.length > 0;

	// Notify parent of filtered count changes (used when search is controlled externally)
	React.useEffect(() => {
		onFilteredCountChange?.(displayedCount);
	}, [displayedCount, onFilteredCountChange]);
	const pluralize = (n: number, noun: string) =>
		n === 1 ? `${n} ${noun.replace(/s$/, "")}` : `${n} ${noun}`;
	const countLabel =
		isTextSearchActive &&
		totalCount !== undefined &&
		displayedCount < totalCount
			? `${displayedCount} of ${pluralize(totalCount, countNoun)}`
			: pluralize(totalCount ?? displayedCount, countNoun);

	// Compute footer content (static node or function of filtered rows)
	// Always use all filtered rows (across all pages) so the footer totals
	// reflect the full dataset, not just the current page.
	const footerSourceRows = allFilteredRows.map((r) => r.original);
	const footerContent =
		typeof footer === "function" ? footer(footerSourceRows) : footer;

	return (
		<div
			className={cn(
				fillHeight ? "flex min-h-0 flex-1 flex-col gap-4" : "w-full space-y-4",
			)}
		>
			{searchable && !isControlledSearch && (
				<div className="flex items-center gap-2">
					{!hideCount && (totalCount !== undefined || displayedCount > 0) && (
						<span className="shrink-0 tabular-nums text-muted-foreground text-sm">
							{countLabel}
						</span>
					)}
					<ExpandableSearch
						onChange={setSearchInput}
						placeholder={searchPlaceholder}
						value={searchInput}
						slashFocus
					/>
				</div>
			)}

			{(!hideCount || countExtra) && !isControlledSearch && !searchable && (totalCount !== undefined || displayedCount > 0) && (
				<div className="flex items-center gap-2">
					{!hideCount && (
						<span className="shrink-0 tabular-nums text-muted-foreground text-sm">
							{countLabel}
						</span>
					)}
					{countExtra}
				</div>
			)}

			<div
				className={cn(
					"relative overflow-hidden rounded-xl border",
					isShiftHeld && hasSelectionMode && "select-none",
					fillHeight && "flex min-h-0 flex-1 flex-col",
				)}
			>
				{renderToolbar?.(table, headerHeight)}

				{/* Scroll container - holds the table and the progressive-render sentinel */}
				<div
					className={cn(
						"overflow-x-auto overflow-y-auto",
						fillHeight ? "min-h-0 flex-1" : "max-h-[48rem]",
					)}
					ref={scrollContainerRef}
				>
					<Table wrapperClassName="overflow-visible">
						<TableHeader ref={headerRef}>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow className="hover:bg-transparent" key={headerGroup.id}>
									{headerGroup.headers.map((header) => {
										const canSort = header.column.getCanSort();
										const sortDirection = header.column.getIsSorted();

										const sortIcon = canSort ? (
											sortDirection ? (
												sortDirection === "asc" ? (
													<ChevronUp className="h-3 w-3" />
												) : (
													<ChevronDown className="h-3 w-3" />
												)
											) : (
												<div className="flex flex-col items-center text-muted-foreground/30">
													<ChevronUp className="h-3 w-3" />
													<ChevronDown className="-mt-1 h-3 w-3" />
												</div>
											)
										) : null;

										const thMeta = header.column.columnDef.meta as Record<string, unknown> | undefined;

										return (
											<TableHead
												className={cn("hover:bg-muted/30", thMeta?.className as string)}
												key={header.id}
												onClick={
													header.column.id === "select"
														? (e) => {
																const target = e.target as HTMLElement;
																if (!target.closest('[role="checkbox"]')) {
																	const cb =
																		e.currentTarget.querySelector<HTMLElement>(
																			'[role="checkbox"]',
																		);
																	cb?.click();
																}
															}
														: canSort
															? header.column.getToggleSortingHandler()
															: undefined
												}
												style={
													header.column.columnDef.size != null && !thMeta?.flex
														? {
																width: header.column.getSize(),
																minWidth: header.column.getSize(),
															}
														: undefined
												}
											>
												{header.isPlaceholder ? null : (
													<div
														className={cn(
															"flex select-none items-center gap-2 rounded-md transition-colors",
															thMeta?.align === "right" ? "justify-end" : "justify-between",
															canSort && "cursor-pointer",
														)}
													>
														{thMeta?.align === "right" && sortIcon && (
															<span className="flex flex-shrink-0 items-center text-muted-foreground/50">
																{sortIcon}
															</span>
														)}
														<span className={cn("truncate font-medium", thMeta?.align === "right" ? "text-right" : "flex-1 text-left")}>
															{flexRender(
																header.column.columnDef.header,
																header.getContext(),
															)}
														</span>
														{thMeta?.align !== "right" && sortIcon && (
															<span className="flex flex-shrink-0 items-center text-muted-foreground/50">
																{sortIcon}
															</span>
														)}
													</div>
												)}
											</TableHead>
										);
									})}
								</TableRow>
							))}
						</TableHeader>
						<TableBody className={cn(footerContent && "[&_tr:last-child]:border-b")}>
							{(() => {
								const rowElements = visibleRows.length ? (
									visibleRows.map((row, rowIndex) => {
										if (renderRow) return renderRow(row);

										const isSelected =
											selectedRows?.has(row.original.id) ?? false;
										const isSelectable = isRowSelectable
											? isRowSelectable(row.original)
											: true;
										const isInPreview =
											previewRange !== null &&
											rowIndex >= previewRange.start &&
											rowIndex <= previewRange.end &&
											isSelectable &&
											!isSelected;

										return (
											<MemoizedDataRow
												cellCount={cellCount}
												columnsVersion={columnsVersion}
												hasClickHandler={!!onRowClick}
												hasSelectionMode={hasSelectionMode}
												isInPreview={isInPreview}
												isSelectable={isSelectable}
												isSelected={isSelected}
												key={row.id}
												onAction={stableOnAction}
												onMouseEnter={stableOnMouseEnter}
												onMouseLeave={stableOnMouseLeave}
												renderContextMenu={
													renderContextMenu ? stableRenderContextMenu : null
												}
												row={row}
												rowExtraClassName={rowClassName?.(row)}
											/>
										);
									})
								) : (
									<TableRow className="hover:bg-transparent">
										<TableCell className="text-center" colSpan={columns.length}>
											{emptyState ?? (
												<div className="py-8 text-muted-foreground text-sm">
													No results found.
												</div>
											)}
										</TableCell>
									</TableRow>
								);

								return renderTableBodyContent
									? renderTableBodyContent(rowElements)
									: rowElements;
							})()}
						</TableBody>
						</Table>

					{/* Sentinel for progressive rendering / infinite scroll */}
					{(hasMoreRows || (progressive && onReachEnd)) && (
						<div className="h-px" ref={sentinelRef} />
					)}
				</div>

				{/* Footer - pinned below scroll area so it's always at the bottom */}
				{footerContent && (
					<table className="w-full border-collapse text-sm">
						{colWidths.length > 0 && (
							<colgroup>
								{colWidths.map((w, i) => (
									<col key={i} style={{ width: w }} />
								))}
							</colgroup>
						)}
						<TableFooter>{footerContent}</TableFooter>
					</table>
				)}
			</div>

			{/* Pagination controls - rendered outside the border/scroll container */}
			{paginationEnabled && (
				<TablePagination
					pageSizeOptions={paginationConfig?.pageSizeOptions}
					table={table}
				/>
			)}
		</div>
	);
}

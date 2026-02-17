"use client";

import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	type Table as TableType,
	useReactTable,
} from "@tanstack/react-table";
import * as React from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { DEFAULT_PAGE_SIZE } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { TablePagination } from "./table-pagination";
import { TableSearch } from "./table-search";

interface DataTableProps<TData> {
	// ... (props remain same)
	data: TData[];
	columns: ColumnDef<TData>[];
	onRowClick?: (row: TData) => void;
	searchPlaceholder?: string;
	emptyState?: React.ReactNode;
	renderToolbar?: (
		table: TableType<TData>,
		headerHeight: string,
	) => React.ReactNode;
	footer?: React.ReactNode;
	initialSorting?: SortingState;
	pageSize?: number;
}

/**
 * A generic, presentational data table component.
 * It handles search, sorting, and pagination internally but delegating
 * toolbars (like selection bars) and footers to the parent.
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
	pageSize = DEFAULT_PAGE_SIZE,
}: DataTableProps<TData>) {
	const [searchInput, setSearchInput] = React.useState("");
	const deferredSearch = React.useDeferredValue(searchInput);

	const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
	const [pagination, setPagination] = React.useState({
		pageIndex: 0,
		pageSize,
	});

	// Reset pagination to page 1 when search changes
	React.useEffect(() => {
		if (deferredSearch !== undefined) {
			setPagination((prev) => ({ ...prev, pageIndex: 0 }));
		}
	}, [deferredSearch]);

	const [hoveredColumn, setHoveredColumn] = React.useState<string | null>(null);

	const table = useReactTable({
		data,
		columns,
		state: {
			sorting,
			pagination,
			globalFilter: deferredSearch,
		},
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		onGlobalFilterChange: (value) => setSearchInput(value ?? ""),
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
	});

	const paginationRows = table.getPaginationRowModel().rows;

	// Ref to measure header height for precise overlay (used by toolbars/selection bars)
	const headerRef = React.useRef<HTMLTableSectionElement>(null);
	const [headerHeight, setHeaderHeight] = React.useState("0px");

	React.useLayoutEffect(() => {
		const headerElement = headerRef.current;
		if (!headerElement) return;

		const updateHeight = () => {
			setHeaderHeight(`${headerElement.offsetHeight}px`);
		};

		updateHeight();
		const observer = new ResizeObserver(updateHeight);
		observer.observe(headerElement);

		return () => observer.disconnect();
	}, []);

	return (
		<div className="w-full space-y-4">
			<TableSearch
				className="max-w-sm"
				onChange={setSearchInput}
				placeholder={searchPlaceholder}
				value={searchInput}
			/>

			<div className="relative max-h-[48rem] overflow-x-auto overflow-y-auto rounded-lg border">
				{renderToolbar?.(table, headerHeight)}

				<Table>
					<TableHeader ref={headerRef}>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow className="hover:bg-transparent" key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const canSort = header.column.getCanSort();
									const sortDirection = header.column.getIsSorted();

									const sortIcon = canSort ? (
										sortDirection ? (
											sortDirection === "asc" ? (
												<IconChevronUp className="h-3 w-3" />
											) : (
												<IconChevronDown className="h-3 w-3" />
											)
										) : (
											<div className="flex flex-col items-center text-muted-foreground/30">
												<IconChevronUp className="h-3 w-3" />
												<IconChevronDown className="-mt-1 h-3 w-3" />
											</div>
										)
									) : null;

									return (
										<TableHead
											className={cn(
												"px-4 py-3",
												hoveredColumn === header.id && "bg-muted/30",
											)}
											key={header.id}
											onClick={
												canSort
													? header.column.getToggleSortingHandler()
													: undefined
											}
											onMouseEnter={() => setHoveredColumn(header.id)}
											onMouseLeave={() => setHoveredColumn(null)}
										>
											{header.isPlaceholder ? null : (
												<div
													className={cn(
														"flex select-none items-center justify-between gap-2 rounded-md transition-colors",
														canSort && "cursor-pointer",
													)}
												>
													<span className="flex-1 truncate text-left font-medium">
														{flexRender(
															header.column.columnDef.header,
															header.getContext(),
														)}
													</span>
													{sortIcon && (
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
					<TableBody>
						{paginationRows.length ? (
							paginationRows.map((row) => (
								<TableRow
									className={cn(
										onRowClick &&
											"cursor-pointer transition-colors hover:bg-muted/50",
									)}
									key={row.id}
									onClick={() => onRowClick?.(row.original)}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell className="px-4 py-3" key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									className="h-24 text-center"
									colSpan={columns.length}
								>
									{emptyState ?? "No results found."}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
					{footer && <TableFooter>{footer}</TableFooter>}
				</Table>
			</div>
			<TablePagination table={table} />
		</div>
	);
}

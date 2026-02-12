"use client";

import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronsLeft,
	IconChevronsRight,
	IconChevronUp,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
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
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
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
	pageSize = 15,
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
			<div className="relative w-full max-w-sm">
				<IconSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="pr-9 pl-9"
					onChange={(e) => setSearchInput(e.target.value)}
					placeholder={searchPlaceholder}
					value={searchInput}
				/>
				{searchInput && (
					<button
						className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => setSearchInput("")}
						type="button"
					>
						<IconX className="h-4 w-4" />
					</button>
				)}
			</div>

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
											<div className="flex flex-col items-center">
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
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-2">
					<Label className="font-medium text-sm" htmlFor="rows-per-page">
						Rows per page
					</Label>
					<Select
						onValueChange={(value) => {
							table.setPageSize(Number(value));
						}}
						value={`${table.getState().pagination.pageSize}`}
					>
						<SelectTrigger className="w-20" id="rows-per-page" size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{[10, 15, 20, 30, 40, 50].map((pageSize) => (
								<SelectItem key={pageSize} value={`${pageSize}`}>
									{pageSize}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center gap-2">
					<div className="text-muted-foreground text-sm">
						Page {table.getState().pagination.pageIndex + 1} of{" "}
						{table.getPageCount()}
					</div>
					<div className="flex items-center gap-1">
						<Button
							disabled={!table.getCanPreviousPage()}
							onClick={() => table.setPageIndex(0)}
							size="sm"
							variant="outline"
						>
							<IconChevronsLeft className="size-4" />
						</Button>
						<Button
							disabled={!table.getCanPreviousPage()}
							onClick={() => table.previousPage()}
							size="sm"
							variant="outline"
						>
							<IconChevronLeft className="size-4" />
						</Button>
						<Button
							disabled={!table.getCanNextPage()}
							onClick={() => table.nextPage()}
							size="sm"
							variant="outline"
						>
							<IconChevronRight className="size-4" />
						</Button>
						<Button
							disabled={!table.getCanNextPage()}
							onClick={() => table.setPageIndex(table.getPageCount() - 1)}
							size="sm"
							variant="outline"
						>
							<IconChevronsRight className="size-4" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

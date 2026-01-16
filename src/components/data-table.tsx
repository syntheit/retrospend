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
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
import { useExpenseModal } from "~/components/expense-modal-provider";
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
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn, convertExpenseAmountForDisplay } from "~/lib/utils";
import { api } from "~/trpc/react";
import { createExpenseColumns, type expenseSchema } from "./data-table-columns";

export function DataTable({
	data,
	homeCurrency = "USD",
	liveRateToBaseCurrency,
	selectedRows = new Set<string>(),
	onSelectionChange,
	onDeleteSelected,
	emptyState,
}: {
	data: z.infer<typeof expenseSchema>[];
	homeCurrency?: string;
	liveRateToBaseCurrency?: number | null;
	selectedRows?: Set<string>;
	onSelectionChange?: (selectedIds: Set<string>) => void;
	onDeleteSelected?: () => void;
	emptyState?: React.ReactNode;
}) {
	const _router = useRouter();
	const { openExpense } = useExpenseModal();
	const { formatCurrency } = useCurrencyFormatter();
	const exportMutation = api.expense.exportCsv.useMutation();
	const [searchInput, setSearchInput] = React.useState("");
	const deferredSearch = React.useDeferredValue(searchInput);

	const [sorting, setSorting] = React.useState<SortingState>([
		{
			id: "date",
			desc: true, // Most recent first
		},
	]);
	const [pagination, setPagination] = React.useState({
		pageIndex: 0,
		pageSize: 15,
	});

	// Reset pagination to page 1 when search changes
	React.useEffect(() => {
		// Use the value to satisfy lint rules while triggering the effect
		if (deferredSearch !== undefined) {
			setPagination((prev) => ({ ...prev, pageIndex: 0 }));
		}
	}, [deferredSearch]);

	const [hoveredColumn, setHoveredColumn] = React.useState<string | null>(null);

	// Internal Selection Handlers
	const handleRowSelect = (id: string, checked: boolean) => {
		if (!onSelectionChange) return;
		const newSelected = new Set(selectedRows);
		if (checked) {
			newSelected.add(id);
		} else {
			newSelected.delete(id);
		}
		onSelectionChange(newSelected);
	};

	const handleSelectAll = (checked: boolean) => {
		if (!onSelectionChange) return;
		if (checked) {
			// Select all visible data
			onSelectionChange(new Set(data.map((expense) => expense.id)));
		} else {
			onSelectionChange(new Set());
		}
	};

	const handleExportSelected = async () => {
		try {
			const expenseIds = Array.from(selectedRows);
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

	// Sync selection with data (cleanup invisible items)
	// This replaces the complex useEffect in the page component
	React.useEffect(() => {
		if (!onSelectionChange || selectedRows.size === 0) return;

		const visibleIds = new Set(data.map((d) => d.id));
		const newSelected = new Set(selectedRows);
		let hasChanges = false;

		for (const selectedId of selectedRows) {
			if (!visibleIds.has(selectedId)) {
				newSelected.delete(selectedId);
				hasChanges = true;
			}
		}

		if (hasChanges) {
			onSelectionChange(newSelected);
		}
	}, [data, selectedRows, onSelectionChange]); // Re-run when data changes (e.g. filters update)

	// Check if any expenses use foreign currency
	const hasForeignCurrencyExpenses = data.some(
		(expense) =>
			expense.currency !== "USD" && expense.exchangeRate && expense.amountInUSD,
	);

	const columns = createExpenseColumns(
		homeCurrency,
		liveRateToBaseCurrency ?? null,
		hasForeignCurrencyExpenses,
		selectedRows,
		handleRowSelect,
		handleSelectAll,
		formatCurrency,
	);

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

	// Expose pagination + sorting state for effect dependencies (table ref is stable)
	const { pageIndex: _pageIndex, pageSize: _pageSize } =
		table.getState().pagination;
	const _sortingState = table.getState().sorting;

	// Ref to measure header height for precise overlay
	const headerRef = React.useRef<HTMLTableSectionElement>(null);
	const [headerHeight, setHeaderHeight] = React.useState("0px");

	React.useLayoutEffect(() => {
		const headerElement = headerRef.current;
		if (!headerElement) {
			return;
		}

		const updateHeight = () => {
			setHeaderHeight(`${headerElement.offsetHeight}px`);
		};

		// Initial measure
		updateHeight();

		// Observe changes
		const observer = new ResizeObserver(updateHeight);
		observer.observe(headerElement);

		return () => observer.disconnect();
	}, []);

	// Totals for the rows currently rendered in the table (post-sort + pagination)
	const paginationRows = table.getPaginationRowModel().rows;
	const totals = React.useMemo(() => {
		let localPriceTotal = 0;
		let defaultPriceTotal = 0;
		const foreignCurrencies = new Set<string>();

		paginationRows.forEach((row) => {
			const { amount, currency, exchangeRate } = row.original;

			// Add to local price total if it's a foreign currency expense
			if (currency !== "USD" && exchangeRate) {
				localPriceTotal += amount;
				foreignCurrencies.add(currency);
			}

			// Add to default price total
			// We calculate this using the same conversion logic as the column itself
			// to ensure the total matches the sum of the visible "Amount (Currency)" column
			const displayAmount = convertExpenseAmountForDisplay(
				row.original,
				homeCurrency,
				liveRateToBaseCurrency ?? null,
			);
			defaultPriceTotal += displayAmount;
		});

		// If we have mixed foreign currencies, the total is meaningless
		const uniqueForeignCurrency =
			foreignCurrencies.size === 1 ? Array.from(foreignCurrencies)[0] : null;

		return {
			localPriceTotal: uniqueForeignCurrency ? localPriceTotal : 0,
			defaultPriceTotal,
			localCurrencyCode: uniqueForeignCurrency,
		};
	}, [paginationRows, homeCurrency, liveRateToBaseCurrency]);

	return (
		<div className="w-full space-y-4">
			<div className="relative w-full max-w-sm">
				<IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="pl-9 pr-9"
					onChange={(e) => setSearchInput(e.target.value)}
					placeholder="Search expenses..."
					value={searchInput}
				/>
				{searchInput && (
					<button
						className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => setSearchInput("")}
						type="button"
					>
						<IconX className="h-4 w-4" />
					</button>
				)}
			</div>

			<div className="relative max-h-[48rem] overflow-x-auto overflow-y-auto rounded-lg border">
				<DataTableSelectionBar
					exportMutation={exportMutation}
					headerHeight={headerHeight}
					onDeleteSelected={onDeleteSelected}
					onEditSelected={(id) => {
						openExpense(id);
						onSelectionChange?.(new Set());
					}}
					onExportSelected={handleExportSelected}
					onSelectAll={handleSelectAll}
					selectedRows={selectedRows}
				/>

				<Table>
					<TableHeader ref={headerRef}>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow className="hover:bg-transparent" key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const isRightAligned =
										header.id === "localPrice" || header.id === "defaultPrice";
									const canSort = header.column.getCanSort();
									const sortDirection = header.column.getIsSorted() as
										| "asc"
										| "desc"
										| false;

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
													<span
														className={cn(
															"flex-1 truncate font-medium",
															isRightAligned ? "text-right" : "text-left",
														)}
													>
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
								<TableRow key={row.id}>
									{row.getVisibleCells().map((cell) => {
										const cellIsRightAligned =
											cell.column.id === "localPrice" ||
											cell.column.id === "defaultPrice";
										return (
											<TableCell
												className={cn(
													"px-4 py-3",
													cellIsRightAligned ? "text-right" : "text-left",
												)}
												key={cell.id}
											>
												{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</TableCell>
										);
									})}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									className="h-24 text-center"
									colSpan={columns.length}
								>
									{emptyState ?? "No expenses found."}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
					<TableFooter>
						<TableRow className="border-t-2 bg-muted/50 font-semibold">
							<TableCell
								className="px-4 py-3 text-left font-semibold"
								colSpan={4}
							>
								Total ({table.getPaginationRowModel().rows.length} items)
							</TableCell>
							{hasForeignCurrencyExpenses && (
								<TableCell className="px-4 py-3 text-right font-semibold">
									{totals.localPriceTotal > 0 && totals.localCurrencyCode && (
										<div className="text-right">
											<span className="font-medium">
												{formatCurrency(
													totals.localPriceTotal,
													totals.localCurrencyCode,
												)}
											</span>
										</div>
									)}
								</TableCell>
							)}
							<TableCell className="px-4 py-3 text-right font-semibold">
								<div className="text-right font-medium">
									{formatCurrency(totals.defaultPriceTotal, homeCurrency)}
								</div>
							</TableCell>
						</TableRow>
					</TableFooter>
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

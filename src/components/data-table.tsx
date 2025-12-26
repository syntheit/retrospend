"use client";

import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronsLeft,
	IconChevronsRight,
	IconChevronUp,
} from "@tabler/icons-react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { Download, Edit, Info, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn, formatCurrencyAmount, getCurrencySymbol } from "~/lib/utils";
import { api } from "~/trpc/react";

export const expenseSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	amount: z.number(),
	currency: z.string(),
	exchangeRate: z.number().nullable(),
	amountInUSD: z.number().nullable(),
	pricingSource: z.string().optional(),
	date: z.date(),
	location: z.string().nullable(),
	description: z.string().nullable(),
	categoryId: z.string().nullable(),
	category: z
		.object({
			id: z.string(),
			name: z.string(),
			color: z.string(),
		})
		.nullable(),
});

function createExpenseColumns(
	_homeCurrency: string,
	hasForeignCurrencyExpenses: boolean,
	selectedRows: Set<string>,
	onRowSelect: (id: string, checked: boolean) => void,
	onSelectAll: (checked: boolean) => void,
): ColumnDef<z.infer<typeof expenseSchema>>[] {
	const columns: ColumnDef<z.infer<typeof expenseSchema>>[] = [
		{
			id: "select",
			header: ({ table }) => {
				const allSelected = table
					.getRowModel()
					.rows.every((row) => selectedRows.has(row.original.id));
				const someSelected = table
					.getRowModel()
					.rows.some((row) => selectedRows.has(row.original.id));

				return (
					<Checkbox
						aria-label="Select all rows"
						checked={
							allSelected ? true : someSelected ? "indeterminate" : false
						}
						onCheckedChange={(checked) => onSelectAll(checked === true)}
					/>
				);
			},
			cell: ({ row }) => (
				<Checkbox
					aria-label={`Select row ${row.original.title || "Untitled"}`}
					checked={selectedRows.has(row.original.id)}
					onCheckedChange={(checked) =>
						onRowSelect(row.original.id, checked === true)
					}
				/>
			),
			enableSorting: false,
			enableHiding: false,
			size: 50,
		},
		{
			accessorKey: "title",
			header: "Title",
			enableSorting: true,
			cell: ({ row }) => {
				const title = row.original.title || "Untitled";
				const description = row.original.description?.trim();

				return (
					<div className="flex items-center gap-2">
						<div className="font-medium">{title}</div>
						{description ? (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex cursor-help items-center gap-1">
											<Info className="h-3 w-3 text-muted-foreground" />
										</div>
									</TooltipTrigger>
									<TooltipContent align="start" side="top">
										<p className="max-w-xs text-sm">{description}</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						) : null}
					</div>
				);
			},
		},
		{
			accessorKey: "category",
			header: "Category",
			enableSorting: true,
			cell: ({ row }) => {
				const category = row.original.category;
				if (!category) {
					return (
						<div className="text-muted-foreground text-sm">No category</div>
					);
				}

				return (
					<div className="flex items-center gap-2">
						<div
							className={cn(
								"h-3 w-3 rounded-full",
								CATEGORY_COLOR_MAP[
									category.color as keyof typeof CATEGORY_COLOR_MAP
								]?.split(" ")[0] || "bg-gray-400",
							)}
						/>
						<span className="text-sm">{category.name}</span>
					</div>
				);
			},
			sortingFn: (rowA, rowB) => {
				const a = rowA.original.category?.name || "";
				const b = rowB.original.category?.name || "";
				return a.localeCompare(b);
			},
		},
		{
			accessorKey: "date",
			header: "Date",
			enableSorting: true,
			sortingFn: "datetime",
			cell: ({ row }) => {
				const date = row.original.date;
				return (
					<div className="text-muted-foreground">
						{format(date, "MMM dd, yyyy")}
					</div>
				);
			},
		},
	];

	// Add local price column only if there are foreign currency expenses
	if (hasForeignCurrencyExpenses) {
		columns.push({
			id: "localPrice",
			header: () => <div className="text-right">Price (Local)</div>,
			accessorFn: (row) => {
				return row.currency === "USD" || !row.exchangeRate ? 0 : row.amount;
			},
			enableSorting: true,
			sortingFn: (rowA, rowB) => {
				const a =
					rowA.original.currency === "USD" || !rowA.original.exchangeRate
						? 0
						: rowA.original.amount;
				const b =
					rowB.original.currency === "USD" || !rowB.original.exchangeRate
						? 0
						: rowB.original.amount;
				return a - b;
			},
			cell: ({ row }) => {
				const { amount, currency, exchangeRate } = row.original;

				// If currency matches USD or no conversion data, show empty
				if (currency === "USD" || !exchangeRate) {
					return <div className="text-right"></div>;
				}

				const currencySymbol = getCurrencySymbol(currency);

				return (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex cursor-help items-center justify-end gap-1 text-right">
									<div className="font-medium">
										{currencySymbol}
										{formatCurrencyAmount(amount)}
									</div>
									<Info className="h-3 w-3 text-muted-foreground" />
								</div>
							</TooltipTrigger>
							<TooltipContent align="end" side="top">
								<p>
									1 USD = {exchangeRate.toLocaleString()} {currency}
								</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				);
			},
		});
	}

	// Always add USD price column
	columns.push({
		id: "defaultPrice",
		header: () => <div className="text-right">Price (USD)</div>,
		accessorFn: (row) => {
			return row.amountInUSD || (row.currency === "USD" ? row.amount : 0);
		},
		enableSorting: true,
		sortingFn: (rowA, rowB) => {
			const a =
				rowA.original.amountInUSD ||
				(rowA.original.currency === "USD" ? rowA.original.amount : 0);
			const b =
				rowB.original.amountInUSD ||
				(rowB.original.currency === "USD" ? rowB.original.amount : 0);
			return a - b;
		},
		cell: ({ row }) => {
			const { amountInUSD, amount, currency } = row.original;
			const defaultCurrencySymbol = "$";

			// Use converted amount if available, otherwise use original amount (if same currency)
			const displayAmount = amountInUSD || (currency === "USD" ? amount : 0);

			return (
				<div className="text-right font-medium">
					{defaultCurrencySymbol}
					{formatCurrencyAmount(displayAmount)}
				</div>
			);
		},
	});

	return columns;
}

export function DataTable({
	data,
	homeCurrency = "USD",
	selectedRows = new Set<string>(),
	onSelectionChange,
	onDeleteSelected,
	emptyState,
}: {
	data: z.infer<typeof expenseSchema>[];
	homeCurrency?: string;
	selectedRows?: Set<string>;
	onSelectionChange?: (selectedIds: Set<string>) => void;
	onDeleteSelected?: () => void;
	emptyState?: React.ReactNode;
}) {
	const _router = useRouter();
	const { openExpense } = useExpenseModal();
	const exportMutation = api.expense.exportCsv.useMutation();
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
				includeDrafts: true, // Include all selected expenses regardless of status
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
		} catch (error: any) {
			toast.error(error?.message ?? "Failed to export selected expenses");
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
		hasForeignCurrencyExpenses,
		selectedRows,
		handleRowSelect,
		handleSelectAll,
	);

	const table = useReactTable({
		data,
		columns,
		state: {
			sorting,
			pagination,
		},
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	// Expose pagination + sorting state for effect dependencies (table ref is stable)
	const { pageIndex, pageSize } = table.getState().pagination;
	const sortingState = table.getState().sorting;

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

		paginationRows.forEach((row) => {
			const { amount, currency, exchangeRate, amountInUSD } = row.original;

			// Add to local price total if it's a foreign currency expense
			if (currency !== "USD" && exchangeRate) {
				localPriceTotal += amount;
			}

			// Add to default price total
			const displayAmount = amountInUSD || (currency === "USD" ? amount : 0);
			defaultPriceTotal += displayAmount;
		});

		return { localPriceTotal, defaultPriceTotal };
	}, [paginationRows]);

	return (
		<div className="w-full space-y-4">
			<div className="relative max-h-[48rem] overflow-auto rounded-lg border">
				{/* Action Bar Overlay */}
				<div
					className={cn(
						"absolute top-0 left-0 z-10 flex w-full items-center gap-2 border-b bg-muted/95 px-4 backdrop-blur-sm transition-all duration-200",
						selectedRows.size > 0
							? "translate-y-0 opacity-100"
							: "pointer-events-none -translate-y-full opacity-0",
					)}
					style={{ height: headerHeight }}
				>
					{/* Checkbox to deselect all */}
					<Checkbox
						aria-label="Deselect all rows"
						checked={true}
						className="mr-2"
						onCheckedChange={() => handleSelectAll(false)}
					/>
					<span className="font-medium text-sm">
						{selectedRows.size} item{selectedRows.size !== 1 ? "s" : ""}{" "}
						selected
					</span>
					<div className="ml-auto flex items-center gap-2">
						<Button
							className="flex h-8 items-center gap-2"
							disabled={exportMutation.isPending}
							onClick={handleExportSelected}
							size="sm"
							variant="ghost"
						>
							<Download className="h-4 w-4" />
							<span className="sr-only sm:not-sr-only sm:inline-block">
								Export
							</span>
						</Button>
						{selectedRows.size === 1 && (
							<Button
								className="flex h-8 items-center gap-2"
								onClick={() => {
									const id = Array.from(selectedRows)[0];
									if (id) {
										openExpense(id);
										onSelectionChange?.(new Set());
									}
								}}
								size="sm"
								variant="ghost"
							>
								<Edit className="h-4 w-4" />
								<span className="sr-only sm:not-sr-only sm:inline-block">
									Edit
								</span>
							</Button>
						)}
						<Button
							className="flex h-8 items-center gap-2"
							onClick={onDeleteSelected}
							size="sm"
							variant="destructive"
						>
							<Trash2 className="h-4 w-4" />
							<span className="sr-only sm:not-sr-only sm:inline-block">
								Delete
							</span>
						</Button>
					</div>
				</div>

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
									{totals.localPriceTotal > 0 && (
										<div className="text-right">
											<span className="font-medium">
												{formatCurrencyAmount(totals.localPriceTotal)}
											</span>
										</div>
									)}
								</TableCell>
							)}
							<TableCell className="px-4 py-3 text-right font-semibold">
								<div className="text-right font-medium">
									{"$"}
									{formatCurrencyAmount(totals.defaultPriceTotal)}
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

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
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import * as React from "react";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
import { Button } from "~/components/ui/button";
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
import { AssetDialog } from "~/components/wealth/asset-dialog";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn, toNumber } from "~/lib/utils";
import { type Asset, createWealthColumns } from "./wealth-table-columns";

export function WealthDataTable({
	data,
	homeCurrency = "USD",
	selectedRows: controlledSelectedRows,
	onSelectionChange: setControlledSelectedRows,
	onDeleteSelected,
}: {
	data: Asset[];
	homeCurrency?: string;
	selectedRows?: Set<string>;
	onSelectionChange?: (selectedIds: Set<string>) => void;
	onDeleteSelected?: (selectedIds: Set<string>) => void;
}) {
	const { formatCurrency } = useCurrencyFormatter();
	const [sorting, setSorting] = React.useState<SortingState>([
		{
			id: "balanceInTarget", // Sort by balance in home currency default
			desc: true,
		},
	]);
	const [pagination, setPagination] = React.useState({
		pageIndex: 0,
		pageSize: 15,
	});
	const [hoveredColumn, setHoveredColumn] = React.useState<string | null>(null);
	const [internalSelectedRows, setInternalSelectedRows] = React.useState<
		Set<string>
	>(new Set());
	const [editingAssetId, setEditingAssetId] = React.useState<string | null>(
		null,
	);

	const selectedRows = controlledSelectedRows ?? internalSelectedRows;
	const setSelectedRows = setControlledSelectedRows ?? setInternalSelectedRows;

	// Internal Selection Handlers
	const handleRowSelect = React.useCallback(
		(id: string, checked: boolean) => {
			const newSelected = new Set(selectedRows);
			if (checked) {
				newSelected.add(id);
			} else {
				newSelected.delete(id);
			}
			setSelectedRows(newSelected);
		},
		[selectedRows, setSelectedRows],
	);

	const handleSelectAll = React.useCallback(
		(checked: boolean) => {
			if (checked) {
				setSelectedRows(new Set(data.map((asset) => asset.id)));
			} else {
				setSelectedRows(new Set());
			}
		},
		[data, setSelectedRows],
	);

	const handleEditSelected = React.useCallback((id: string) => {
		setEditingAssetId(id);
	}, []);

	// Check if any asset uses foreign currency
	const hasForeignCurrency = React.useMemo(() => {
		return data.some((asset) => asset.currency !== homeCurrency);
	}, [data, homeCurrency]);

	const columns = React.useMemo(
		() =>
			createWealthColumns(
				homeCurrency,
				hasForeignCurrency,
				selectedRows,
				handleRowSelect,
				handleSelectAll,
				formatCurrency,
				handleEditSelected,
			),
		[
			homeCurrency,
			hasForeignCurrency,
			selectedRows,
			handleRowSelect,
			handleSelectAll,
			formatCurrency,
			handleEditSelected,
		],
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

	// Totals for the rows currently rendered in the table
	const paginationRows = table.getPaginationRowModel().rows;
	const totals = React.useMemo(() => {
		let balanceTotal = 0;
		let usdTotal = 0;

		paginationRows.forEach((row) => {
			balanceTotal += row.original.balanceInTargetCurrency;
			usdTotal += row.original.balanceInUSD;
		});

		return { balanceTotal, usdTotal };
	}, [paginationRows]);

	// Find the asset currently being edited
	const editingAsset = React.useMemo(() => {
		if (!editingAssetId) return undefined;
		return data.find((a) => a.id === editingAssetId);
	}, [data, editingAssetId]);

	return (
		<div className="w-full space-y-4">
			<div className="relative max-h-[48rem] overflow-x-auto overflow-y-auto rounded-lg border">
				<DataTableSelectionBar
					headerHeight={headerHeight}
					onDeleteSelected={
						onDeleteSelected
							? () => {
									onDeleteSelected(selectedRows);
								}
							: undefined
					}
					onEditSelected={(id) => {
						setEditingAssetId(id);
						setSelectedRows(new Set());
					}}
					onSelectAll={handleSelectAll}
					selectedRows={selectedRows}
				/>

				<Table>
					<TableHeader ref={headerRef}>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow className="hover:bg-transparent" key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const isRightAligned =
										header.id === "originalBalance" ||
										header.id === "balanceInTarget" ||
										header.id === "balanceInUSD";
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
								<TableRow
									data-state={
										selectedRows.has(row.original.id) ? "selected" : undefined
									}
									key={row.id}
								>
									{row.getVisibleCells().map((cell) => {
										const cellIsRightAligned =
											cell.column.id === "originalBalance" ||
											cell.column.id === "balanceInTarget" ||
											cell.column.id === "balanceInUSD";
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
									No assets found.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
					<TableFooter>
						<TableRow className="border-t-2 bg-muted/50 font-semibold">
							<TableCell
								className="px-4 py-3 text-left font-semibold"
								colSpan={hasForeignCurrency ? 4 : 3}
							>
								Total ({table.getFilteredRowModel().rows.length} items)
							</TableCell>
							<TableCell className="px-4 py-3 text-right font-semibold">
								<div className="text-right font-medium">
									{formatCurrency(totals.balanceTotal, homeCurrency)}
								</div>
							</TableCell>
							{homeCurrency !== "USD" && (
								<TableCell className="px-4 py-3 text-right font-semibold">
									<div className="text-right font-medium">
										{formatCurrency(totals.usdTotal, "USD")}
									</div>
								</TableCell>
							)}
						</TableRow>
					</TableFooter>
				</Table>
			</div>

			{/* Pagination Controls */}
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

			{/* Asset Dialog Wrapper for Controlled Edit */}
			<ControlledAssetDialog
				asset={editingAsset}
				isOpen={!!editingAssetId}
				onOpenChange={(open) => !open && setEditingAssetId(null)}
			/>
		</div>
	);
}

// Wrapper to handle controlled dialog state for editing
function ControlledAssetDialog({
	isOpen,
	onOpenChange,
	asset,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	asset?: Asset;
}) {
	// If no asset, don't render anything (or render create mode? logic says editing)
	if (!asset) return null;

	return (
		<AssetDialog
			assetId={asset.id}
			initialValues={{
				name: asset.name,
				type: asset.type,
				currency: asset.currency,
				balance: asset.balance,
				isLiquid: asset.isLiquid,
				exchangeRate: toNumber(asset.exchangeRate),
				exchangeRateType: asset.exchangeRateType,
				interestRate: asset.interestRate,
			}}
			key={asset.id}
			mode="edit"
			onOpenChange={onOpenChange}
			open={isOpen}
		/>
	);
}

"use client";

import type { Row, VisibilityState } from "@tanstack/react-table";
import { Edit2, Landmark, Trash2 } from "lucide-react";
import * as React from "react";
import { DataTable } from "~/components/data-table";
import { DataTableSelectionBar } from "~/components/data-table-selection-bar";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "~/components/ui/context-menu";
import { EmptyState } from "~/components/ui/empty-state";
import { TableCell, TableRow } from "~/components/ui/table";
import { AssetDialog } from "~/components/wealth/asset-dialog";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { toNumber } from "~/lib/utils";
import { type Asset, createWealthColumns } from "./wealth-table-columns";

export function WealthDataTable({
	data,
	homeCurrency = "USD",
	selectedRows: controlledSelectedRows,
	onSelectionChange: setControlledSelectedRows,
	onDeleteSelected,
	totalNetWorth = 0,
	isPrivacyMode = false,
	hidePagination = false,
	fillHeight = false,
	readOnly = false,
	columnVisibility: initialColumnVisibility = {},
}: {
	data: Asset[];
	homeCurrency?: string;
	totalNetWorth?: number;
	isPrivacyMode?: boolean;
	selectedRows?: Set<string>;
	onSelectionChange?: (selectedIds: Set<string>) => void;
	onDeleteSelected?: (selectedIds: Set<string>) => void;
	/** @deprecated no longer has any effect; progressive rendering is always used */
	hidePagination?: boolean;
	fillHeight?: boolean;
	readOnly?: boolean;
	columnVisibility?: VisibilityState;
}) {
	const { formatCurrency } = useCurrencyFormatter();
	const [editingAssetId, setEditingAssetId] = React.useState<string | null>(
		null,
	);

	const isSelectionActive = Boolean(
		controlledSelectedRows && controlledSelectedRows.size > 0,
	);

	const selectionHandlers = React.useMemo(() => {
		if (!setControlledSelectedRows || !controlledSelectedRows) return undefined;
		if (!isSelectionActive) return undefined;

		return {
			selectedRows: controlledSelectedRows,
			onToggle: (id: string) => {
				const next = new Set(controlledSelectedRows);
				if (next.has(id)) {
					next.delete(id);
				} else {
					next.add(id);
				}
				setControlledSelectedRows(next);
			},
			onToggleAll: (ids: string[], checked: boolean) => {
				const next = new Set(controlledSelectedRows);
				for (const id of ids) {
					if (checked) {
						next.add(id);
					} else {
						next.delete(id);
					}
				}
				setControlledSelectedRows(next);
			},
		};
	}, [controlledSelectedRows, setControlledSelectedRows, isSelectionActive]);

	const columns = React.useMemo(
		() =>
			createWealthColumns(
				homeCurrency,
				formatCurrency,
				totalNetWorth,
				isPrivacyMode,
				selectionHandlers,
			),
		[
			homeCurrency,
			formatCurrency,
			totalNetWorth,
			isPrivacyMode,
			selectionHandlers,
		],
	);

	const selectedRows = controlledSelectedRows ?? new Set<string>();

	const editingAsset = React.useMemo(() => {
		if (!editingAssetId) return undefined;
		return data.find((a) => a.id === editingAssetId);
	}, [data, editingAssetId]);

	const renderContextMenu = React.useMemo(() => {
		return (row: Asset) => (
			<>
				<ContextMenuItem
					className="cursor-pointer"
					onClick={readOnly ? undefined : () => setEditingAssetId(row.id)}
				>
					<Edit2 className="mr-2 h-4 w-4" />
					Edit asset
				</ContextMenuItem>
				{(onDeleteSelected || readOnly) && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							className="cursor-pointer"
							onClick={
								readOnly
									? undefined
									: () => onDeleteSelected?.(new Set([row.id]))
							}
							variant="destructive"
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete asset
						</ContextMenuItem>
					</>
				)}
			</>
		);
	}, [readOnly, onDeleteSelected]);

	const renderToolbar = React.useCallback(
		(_table: unknown, headerHeight: string) => {
			if (readOnly || !setControlledSelectedRows) return null;
			return (
				<DataTableSelectionBar
					headerHeight={headerHeight}
					onDeleteSelected={
						onDeleteSelected ? () => onDeleteSelected(selectedRows) : undefined
					}
					onEditSelected={(id) => {
						setEditingAssetId(id);
						setControlledSelectedRows(new Set());
					}}
					onSelectAll={(checked) => {
						if (!checked) setControlledSelectedRows(new Set());
					}}
					selectedRows={selectedRows}
				/>
			);
		},
		[readOnly, selectedRows, onDeleteSelected, setControlledSelectedRows],
	);

	const footer = React.useCallback(
		(filteredRows: Asset[]) => {
			const colCount = columns.length;

			return (
				<TableRow>
					<TableCell
						className="text-left font-medium"
						colSpan={colCount}
					>
						Total ({filteredRows.length} items)
					</TableCell>
				</TableRow>
			);
		},
		[columns.length],
	);

	return (
		<div className={fillHeight ? "flex min-h-0 flex-1 flex-col" : "w-full"}>
			<DataTable
				columns={columns}
				columnVisibility={initialColumnVisibility}
				countNoun="assets"
				data={data}
				emptyState={
					<EmptyState
						className="py-8"
						description="Add your first asset or liability to start tracking your net worth."
						icon={Landmark}
						title="No Assets Found"
					/>
				}
				fillHeight={fillHeight}
				footer={footer}
				initialSorting={[{ id: "balanceInTarget", desc: true }]}
				onRowClick={readOnly ? undefined : (row) => setEditingAssetId(row.id)}
				progressive
				renderContextMenu={renderContextMenu}
				renderToolbar={renderToolbar}
				searchable={false}
			/>

			{!readOnly && (
				<ControlledAssetDialog
					asset={editingAsset}
					isOpen={!!editingAssetId}
					onOpenChange={(open) => !open && setEditingAssetId(null)}
				/>
			)}
		</div>
	);
}

function ControlledAssetDialog({
	isOpen,
	onOpenChange,
	asset,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	asset?: Asset;
}) {
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
				exchangeRateType: asset.exchangeRateType ?? undefined,
				interestRate: asset.interestRate ?? undefined,
			}}
			key={asset.id}
			onOpenChange={onOpenChange}
			open={isOpen}
		/>
	);
}

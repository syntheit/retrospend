"use client";

import type { ColumnVisibilityState } from "@tanstack/react-table";
import { Archive, Edit2, Landmark, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { DataTable } from "~/components/data-table";
import type { DataTableRow } from "~/components/data-table-features";
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
	onCloseSelected,
	onDeletePermanently,
	totalAssets = 0,
	isPrivacyMode = false,
	hidePagination = false,
	fillHeight = false,
	readOnly = false,
	columnVisibility: initialColumnVisibility = {},
}: {
	data: Asset[];
	homeCurrency?: string;
	totalAssets?: number;
	isPrivacyMode?: boolean;
	selectedRows?: Set<string>;
	onSelectionChange?: (selectedIds: Set<string>) => void;
	/** Closes accounts: out of the totals from today, history kept. */
	onCloseSelected?: (selectedIds: Set<string>) => void;
	/** Deletes an account and its balance history. */
	onDeletePermanently?: (id: string) => void;
	/** @deprecated no longer has any effect; progressive rendering is always used */
	hidePagination?: boolean;
	fillHeight?: boolean;
	readOnly?: boolean;
	columnVisibility?: ColumnVisibilityState;
}) {
	const t = useTranslations("wealth");
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
				totalAssets,
				isPrivacyMode,
				selectionHandlers,
				t,
			),
		[
			homeCurrency,
			formatCurrency,
			totalAssets,
			isPrivacyMode,
			selectionHandlers,
			t,
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
					{t("editAssetAction")}
				</ContextMenuItem>
				{(onCloseSelected || onDeletePermanently || readOnly) && (
					<ContextMenuSeparator />
				)}
				{(onCloseSelected || readOnly) && (
					<ContextMenuItem
						className="cursor-pointer"
						onClick={
							readOnly
								? undefined
								: () => onCloseSelected?.(new Set([row.id]))
						}
					>
						<Archive className="mr-2 h-4 w-4" />
						{t("closeAccount")}
					</ContextMenuItem>
				)}
				{(onDeletePermanently || readOnly) && (
					<ContextMenuItem
						className="cursor-pointer"
						onClick={
							readOnly ? undefined : () => onDeletePermanently?.(row.id)
						}
						variant="destructive"
					>
						<Trash2 className="mr-2 h-4 w-4" />
						{t("deletePermanently")}
					</ContextMenuItem>
				)}
			</>
		);
	}, [readOnly, onCloseSelected, onDeletePermanently, t]);

	const renderToolbar = React.useCallback(
		(_table: unknown, headerHeight: string) => {
			if (readOnly || !setControlledSelectedRows) return null;
			return (
				<DataTableSelectionBar
					headerHeight={headerHeight}
					deleteLabel={
						selectedRows.size > 1 ? t("closeAccounts") : t("closeAccount")
					}
					onDeleteSelected={
						onCloseSelected ? () => onCloseSelected(selectedRows) : undefined
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
		[readOnly, selectedRows, onCloseSelected, setControlledSelectedRows, t],
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
						{t("totalItems", { count: filteredRows.length })}
					</TableCell>
				</TableRow>
			);
		},
		[columns.length, t],
	);

	return (
		<div className={fillHeight ? "flex min-h-0 flex-1 flex-col" : "w-full"}>
			<DataTable
				columns={columns}
				columnVisibility={initialColumnVisibility}
				countNoun={t("assetsNoun")}
				data={data}
				emptyState={
					<EmptyState
						className="py-8"
						description={t("noAssetsDescription")}
						icon={Landmark}
						title={t("noAssetsTitle")}
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

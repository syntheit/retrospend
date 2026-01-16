"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { Info } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { AssetType } from "~/lib/db-enums";

export interface Asset {
	id: string;
	name: string;
	type: AssetType;
	currency: string;
	balance: number;
	balanceInUSD: number;
	balanceInTargetCurrency: number;
	exchangeRate?: number | object;
	exchangeRateType?: string;
	isLiquid: boolean;
	interestRate?: number;
}

const getTypeColor = (type: AssetType) => {
	switch (type) {
		case AssetType.CASH:
			return "default";
		case AssetType.INVESTMENT:
			return "secondary";
		case AssetType.CRYPTO:
			return "outline";
		case AssetType.REAL_ESTATE:
			return "secondary";
		case AssetType.LIABILITY_LOAN:
		case AssetType.LIABILITY_CREDIT_CARD:
		case AssetType.LIABILITY_MORTGAGE:
			return "outline"; // neutral for liabilities
		default:
			return "default";
	}
};

export function createWealthColumns(
	homeCurrency: string,
	hasForeignCurrency: boolean,
	selectedRows: Set<string>,
	onRowSelect: (id: string, checked: boolean) => void,
	onSelectAll: (checked: boolean) => void,
	formatCurrency: (amount: number, currency?: string) => string,
	_onEdit: (id: string) => void,
): ColumnDef<Asset>[] {
	const columns: ColumnDef<Asset>[] = [
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
					aria-label={`Select row ${row.original.name}`}
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
			accessorKey: "name",
			header: "Name",
			enableSorting: true,
			cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
		},
		{
			accessorKey: "type",
			header: "Type",
			enableSorting: true,
			cell: ({ row }) => (
				<div className="flex items-center gap-2">
					<Badge variant={getTypeColor(row.original.type)}>
						{row.original.type.replace("LIABILITY_", "").replace("_", " ")}
					</Badge>
					{row.original.isLiquid && (
						<Badge className="ml-2" variant="outline">
							Liquid
						</Badge>
					)}
				</div>
			),
		},
	];

	// Add foreign currency column if needed
	if (hasForeignCurrency) {
		columns.push({
			id: "originalBalance",
			header: () => <div className="text-right">Original</div>,
			accessorFn: (row) => {
				return row.currency !== homeCurrency ? row.balance : 0;
			},
			enableSorting: true,
			cell: ({ row }) => {
				const { balance, currency } = row.original;
				if (currency === homeCurrency) {
					return <div className="text-right text-muted-foreground">-</div>;
				}
				return (
					<div className="text-right font-medium">
						{formatCurrency(balance, currency)}
					</div>
				);
			},
		});

		columns.push({
			id: "exchangeRate",
			header: "Rate/Source",
			accessorFn: (row) => row.exchangeRateType || "",
			enableSorting: false,
			cell: ({ row }) => {
				const { currency, exchangeRateType, interestRate } = row.original;

				// Prioritize interest rate for liabilities
				const isLiability =
					row.original.type === AssetType.LIABILITY_LOAN ||
					row.original.type === AssetType.LIABILITY_CREDIT_CARD ||
					row.original.type === AssetType.LIABILITY_MORTGAGE;

				if (isLiability && interestRate) {
					return <span className="text-sm">{interestRate}% APR</span>;
				}

				if (currency !== homeCurrency && exchangeRateType) {
					return (
						<Badge className="text-xs" variant="outline">
							{exchangeRateType.charAt(0).toUpperCase() +
								exchangeRateType.slice(1)}
						</Badge>
					);
				}

				return <span className="text-muted-foreground">-</span>;
			},
		});
	}

	// Column: Balance (Target/Home Currency)
	columns.push({
		id: "balanceInTarget",
		header: () => <div className="text-right">Balance ({homeCurrency})</div>,
		accessorKey: "balanceInTargetCurrency",
		enableSorting: true,
		cell: ({ row }) => (
			<div className="text-right font-medium">
				{formatCurrency(row.original.balanceInTargetCurrency, homeCurrency)}
			</div>
		),
	});

	// Column: Value (USD)
	if (homeCurrency !== "USD") {
		columns.push({
			id: "balanceInUSD",
			header: ({ column }) => (
				<div className="text-right">
					<Button
						className="p-0 hover:bg-transparent"
						onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
						variant="ghost"
					>
						Value (USD)
						<Info className="ml-2 h-4 w-4" />
					</Button>
				</div>
			),
			accessorKey: "balanceInUSD",
			enableSorting: true,
			cell: ({ row }) => (
				<div className="text-right text-muted-foreground">
					{formatCurrency(row.original.balanceInUSD, "USD")}
				</div>
			),
		});
	}

	return columns;
}

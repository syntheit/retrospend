"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
	Banknote,
	Coins,
	CreditCard,
	Home,
	Info,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { AssetType } from "~/lib/db-enums";
import { maskAmount } from "~/lib/masking";

export interface Asset {
	id: string;
	name: string;
	type: AssetType;
	currency: string;
	balance: number;
	balanceInUSD: number;
	balanceInTargetCurrency: number;
	exchangeRate?: number | object | null;
	exchangeRateType?: string | null;
	isLiquid: boolean;
	interestRate?: number | null;
}

const getAssetConfig = (type: AssetType) => {
	switch (type) {
		case AssetType.CASH:
			return {
				icon: Wallet,
				label: "Cash",
			};
		case AssetType.INVESTMENT:
			return {
				icon: TrendingUp,
				label: "Investment",
			};
		case AssetType.CRYPTO:
			return {
				icon: Coins,
				label: "Crypto",
			};
		case AssetType.REAL_ESTATE:
			return {
				icon: Home,
				label: "Real Estate",
			};
		default:
			if (type.startsWith("LIABILITY_")) {
				return {
					icon: CreditCard,
					label: type.replace("LIABILITY_", "").replace("_", " "),
				};
			}
			return {
				icon: Banknote,
				label: type,
			};
	}
};

export function createWealthColumns(
	homeCurrency: string,
	formatCurrency: (amount: number, currency?: string) => string,
	isSelectionActive: boolean,
	totalNetWorth: number,
	isPrivacyMode = false,
): ColumnDef<Asset>[] {
	const columns: ColumnDef<Asset>[] = [];

	// Only show checkbox column if selection is active
	if (isSelectionActive) {
		columns.push({
			id: "select",
			header: ({ table }) => (
				<Checkbox
					aria-label="Select all rows"
					checked={
						table.getIsAllPageRowsSelected() ||
						(table.getIsSomePageRowsSelected() && "indeterminate")
					}
					onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
				/>
			),
			cell: ({ row }) => (
				<Checkbox
					aria-label={`Select row ${row.original.name}`}
					checked={row.getIsSelected()}
					onCheckedChange={(value) => row.toggleSelected(!!value)}
				/>
			),
			enableSorting: false,
			enableHiding: false,
			size: 40,
		});
	}

	// Column 1: Identity (Icon + Name + Liquid Badge)
	columns.push({
		accessorKey: "name",
		header: "Asset",
		enableSorting: true,
		cell: ({ row }) => {
			const { icon: Icon, label } = getAssetConfig(row.original.type);
			return (
				<div className="flex items-center gap-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
						{row.original.type === AssetType.CRYPTO ? (
							<CurrencyFlag
								className="h-full w-full"
								currencyCode={row.original.currency}
							/>
						) : (
							<Icon className="h-4 w-4" />
						)}
					</div>
					<div className="flex min-w-0 flex-col leading-tight">
						<div className="flex items-center gap-2 truncate font-medium text-foreground text-sm">
							<span className="truncate">{row.original.name}</span>
							{row.original.isLiquid && (
								<Badge
									className="bg-emerald-500/10 px-1.5 py-0 font-medium text-[9px] text-emerald-600 uppercase tracking-wide hover:bg-emerald-500/20"
									variant="secondary"
								>
									Liquid
								</Badge>
							)}
						</div>
						<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground leading-tight">
							<span>{label}</span>
							{row.original.currency !== homeCurrency && (
								<>
									<span className="text-[10px] opacity-40">•</span>
									<span>{row.original.currency}</span>
								</>
							)}
						</div>
					</div>
				</div>
			);
		},
	});

	// Column 2: Allocation Visualization
	columns.push({
		id: "allocation",
		header: "Allocation",
		cell: ({ row }) => {
			// Calculate allocation percentage (relative to net worth)
			// Avoid negative/divide-by-zero issues
			const value = row.original.balanceInTargetCurrency;
			const percentage = totalNetWorth > 0 ? (value / totalNetWorth) * 100 : 0;
			const displayPercentage = Math.max(0, percentage);

			return (
				<div className="flex items-center gap-3 pr-8">
					<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/30">
						<div
							className="h-full rounded-full bg-primary transition-all duration-500"
							style={{ width: `${Math.min(100, displayPercentage)}%` }}
						/>
					</div>
					<span className="min-w-[32px] font-medium text-[11px] text-muted-foreground tabular-nums">
						{Math.round(displayPercentage)}%
					</span>
				</div>
			);
		},
	});

	// Column 3: Balance (Rich style)
	columns.push({
		id: "balanceInTarget",
		header: () => <div className="text-right">Balance</div>,
		accessorKey: "balanceInTargetCurrency",
		enableSorting: true,
		cell: ({ row }) => {
			const { balanceInTargetCurrency, currency, balance } = row.original;
			const isForeign = currency !== homeCurrency;

			return (
				<div className="flex flex-col items-end gap-0.5">
					<div className="font-bold text-foreground text-sm tabular-nums leading-tight tracking-tight">
						{isPrivacyMode
							? maskAmount(balanceInTargetCurrency)
							: formatCurrency(balanceInTargetCurrency, homeCurrency)}
					</div>
					{isForeign && (
						<div className="text-[10px] text-muted-foreground tabular-nums leading-tight">
							{isPrivacyMode
								? maskAmount(balance)
								: row.original.exchangeRateType === "crypto"
									? // High precision for crypto sub-text
										`${new Intl.NumberFormat("en-US", {
											minimumFractionDigits: 2,
											maximumFractionDigits: 8,
										}).format(balance)} ${currency}`
									: formatCurrency(balance, currency)}
						</div>
					)}
				</div>
			);
		},
	});

	// Optional USD Column if home is not USD
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
				<div className="text-right font-medium text-muted-foreground text-xs tabular-nums">
					{isPrivacyMode
						? maskAmount(row.original.balanceInUSD)
						: formatCurrency(row.original.balanceInUSD, "USD")}
				</div>
			),
		});
	}

	return columns;
}

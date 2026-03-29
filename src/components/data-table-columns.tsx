"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Edit2, EyeOff, Info, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { z } from "zod";
import { CategoryChip, NoCategoryLabel } from "~/components/category-chip";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { AvatarStack } from "~/components/ui/avatar-stack";
import { isCrypto } from "~/lib/currency-format";
import { formatExpenseDate } from "~/lib/format";
import { convertExpenseAmountForDisplay } from "~/lib/utils";

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
			icon: z.string().nullable().optional(),
		})
		.nullable(),
	isAmortizedParent: z.boolean().optional(),
	excludeFromAnalytics: z.boolean().optional(),
	source: z.enum(["personal", "shared"]).optional(),
	sharedContext: z
		.object({
			totalAmount: z.number(),
			participantCount: z.number(),
			paidByName: z.string(),
			paidByAvatarUrl: z.string().nullable().optional(),
			iPayedThis: z.boolean(),
			transactionId: z.string(),
			projectId: z.string().optional(),
			projectName: z.string().optional(),
			canEdit: z.boolean().optional(),
			canDelete: z.boolean().optional(),
			splitParticipants: z.array(z.object({
				participantType: z.string(),
				participantId: z.string(),
				shareAmount: z.number(),
				name: z.string(),
				avatarUrl: z.string().nullable(),
			})).optional(),
		})
		.optional(),
});

function createExpenseColumns(
	_homeCurrency: string,
	_liveRateToBaseCurrency: number | null,
	hasForeignCurrencyExpenses: boolean,
	formatCurrency: (amount: number, currency?: string) => string,
	onRowEdit?: (id: string) => void,
	onRowDelete?: (id: string) => void,
	typeFilter?: "all" | "personal" | "shared",
	onSharedRowEdit?: (sharedTransactionId: string) => void,
	onSharedRowDelete?: (sharedTransactionId: string) => void,
	onRowDuplicate?: (id: string) => void,
	hasSharedExpenses?: boolean,
): ColumnDef<z.infer<typeof expenseSchema>>[] {
	const columns: ColumnDef<z.infer<typeof expenseSchema>>[] = [
		{
			accessorKey: "title",
			header: "Title",
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => {
				const title = row.original.title || "Untitled";
				const description = row.original.description?.trim();
				const isAmortized = row.original.isAmortizedParent;
				const isExcluded = row.original.excludeFromAnalytics;
				const isShared = row.original.source === "shared";
				const sharedCtx = row.original.sharedContext;

				const sharedTooltip = sharedCtx
					? `${sharedCtx.iPayedThis ? "You paid" : `Paid by ${sharedCtx.paidByName}`} · Split ${sharedCtx.participantCount} ways${sharedCtx.projectName ? ` · ${sharedCtx.projectName}` : ""}`
					: undefined;

				return (
					<div className="flex items-center gap-2">
						<div className="font-medium">{title}</div>
						{isAmortized && (
							<span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 font-medium text-blue-700 text-xs ring-1 ring-blue-700/10 ring-inset dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/30">
								Split
							</span>
						)}
						{isExcluded && !isShared && (
							<Tooltip>
								<TooltipTrigger asChild>
									<EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								</TooltipTrigger>
								<TooltipContent align="start" side="top">
									<p>Excluded from spending analytics</p>
								</TooltipContent>
							</Tooltip>
						)}
						{isShared && sharedTooltip ? (
							<Tooltip>
								<TooltipTrigger asChild>
									{sharedCtx?.projectId ? (
										<Link
											className="inline-flex cursor-pointer items-center rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-700 text-xs ring-1 ring-purple-700/10 ring-inset hover:bg-purple-100 dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/30 dark:hover:bg-purple-400/20"
											href={`/projects/${sharedCtx.projectId}`}
											onClick={(e) => e.stopPropagation()}
										>
											{sharedCtx.projectName ?? "Shared"}
										</Link>
									) : (
										<span className="inline-flex cursor-help items-center rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-700 text-xs ring-1 ring-purple-700/10 ring-inset dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/30">
											{sharedCtx?.projectName ?? "Shared"}
										</span>
									)}
								</TooltipTrigger>
								<TooltipContent align="start" side="top">
									<p className="max-w-xs text-sm">{sharedTooltip}</p>
								</TooltipContent>
							</Tooltip>
						) : description ? (
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
						) : null}
					</div>
				);
			},
		},
		{
			accessorKey: "category",
			header: "Category",
			enableSorting: true,
			size: 150,
			cell: ({ row }) => {
				const category = row.original.category;
				if (!category) return <NoCategoryLabel />;
				return (
					<CategoryChip
						color={category.color}
						icon={category.icon}
						name={category.name}
					/>
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
			size: 130,
			sortingFn: "datetime",
			cell: ({ row }) => {
				const date = row.original.date;
				return (
					<div className="text-muted-foreground">
						{formatExpenseDate(date)}
					</div>
				);
			},
		},
	];

	// Add "Who" column when user has shared expenses and filter includes them
	if (hasSharedExpenses && typeFilter !== "personal") {
		const dateIndex = columns.findIndex((c) => "accessorKey" in c && c.accessorKey === "date");
		columns.splice(dateIndex, 0, {
			id: "split",
			header: "Who",
			enableSorting: false,
			size: 130,
			cell: ({ row }) => {
				const participants = row.original.sharedContext?.splitParticipants;
				if (!participants || participants.length === 0) {
					return <span className="text-muted-foreground">—</span>;
				}
				return (
					<AvatarStack
						currency={row.original.currency}
						formatCurrency={formatCurrency}
						participants={participants}
					/>
				);
			},
		});
	}

	// Add local price column only if there are foreign currency expenses
	if (hasForeignCurrencyExpenses) {
		columns.push({
			id: "localPrice",
			header: () => <div className="text-right">Price (Local)</div>,
			size: 150,
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

				return (
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="flex cursor-help items-center justify-end gap-1 text-right">
								<div className="font-medium tabular-nums">
									{formatCurrency(amount, currency)}
								</div>
								<Info className="h-3 w-3 text-muted-foreground" />
							</div>
						</TooltipTrigger>
						<TooltipContent align="end" side="top">
							<p>
								{isCrypto(currency)
									? `1 ${currency} = $${exchangeRate.toLocaleString()}`
									: `1 USD = ${exchangeRate.toLocaleString()} ${currency}`}
							</p>
						</TooltipContent>
					</Tooltip>
				);
			},
		});
	}

	// Always add base currency price column
	columns.push({
		id: "basePrice",
		header: () => <div className="text-right">Amount ({_homeCurrency})</div>,
		size: 160,
		accessorFn: (row) => {
			return convertExpenseAmountForDisplay(
				row,
				_homeCurrency,
				_liveRateToBaseCurrency,
			);
		},
		enableSorting: true,
		sortingFn: (rowA, rowB) => {
			const a = convertExpenseAmountForDisplay(
				rowA.original,
				_homeCurrency,
				_liveRateToBaseCurrency,
			);
			const b = convertExpenseAmountForDisplay(
				rowB.original,
				_homeCurrency,
				_liveRateToBaseCurrency,
			);
			return a - b;
		},
		cell: ({ row }) => {
			const displayAmount = convertExpenseAmountForDisplay(
				row.original,
				_homeCurrency,
				_liveRateToBaseCurrency,
			);

			return (
				<div className="text-right font-medium tabular-nums">
					{formatCurrency(displayAmount, _homeCurrency)}
				</div>
			);
		},
	});

	// Add per-row actions column if handlers are provided
	if (onRowEdit ?? onRowDelete ?? onRowDuplicate) {
		columns.push({
			id: "actions",
			header: () => null,
			cell: ({ row }) => {
				const isShared = row.original.source === "shared";
				const sharedCtx = row.original.sharedContext;

				if (isShared) {
					const sharedTxId = sharedCtx?.transactionId;
					if (!sharedTxId) return <div className="h-7 w-7" />;
					const canEdit = sharedCtx?.canEdit && onSharedRowEdit;
					const canDelete = sharedCtx?.canDelete && onSharedRowDelete;
					if (!canEdit && !canDelete) return <div className="h-7 w-7" />;

					return (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									className="h-7 w-7 md:opacity-0 transition-opacity md:group-hover:opacity-100"
									size="icon"
									variant="ghost"
								>
									<MoreHorizontal className="h-4 w-4" />
									<span className="sr-only">Actions</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-44">
								{canEdit && (
									<DropdownMenuItem onClick={() => onSharedRowEdit!(sharedTxId)}>
										<Edit2 className="mr-2 h-4 w-4" />
										Edit
									</DropdownMenuItem>
								)}
								{canDelete && canEdit && <DropdownMenuSeparator />}
								{canDelete && (
									<DropdownMenuItem
										onClick={() => onSharedRowDelete!(sharedTxId)}
										variant="destructive"
									>
										<Trash2 className="mr-2 h-4 w-4" />
										Delete
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					);
				}

				return (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								className="h-7 w-7 md:opacity-0 transition-opacity md:group-hover:opacity-100"
								size="icon"
								variant="ghost"
							>
								<MoreHorizontal className="h-4 w-4" />
								<span className="sr-only">Actions</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							{onRowEdit && (
								<DropdownMenuItem onClick={() => onRowEdit(row.original.id)}>
									<Edit2 className="mr-2 h-4 w-4" />
									Edit
								</DropdownMenuItem>
							)}
							{onRowDuplicate && (
								<DropdownMenuItem onClick={() => onRowDuplicate(row.original.id)}>
									<Copy className="mr-2 h-4 w-4" />
									Duplicate
								</DropdownMenuItem>
							)}
							{onRowDelete && (onRowEdit || onRowDuplicate) && <DropdownMenuSeparator />}
							{onRowDelete && (
								<DropdownMenuItem
									onClick={() => onRowDelete(row.original.id)}
									variant="destructive"
								>
									<Trash2 className="mr-2 h-4 w-4" />
									Delete
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				);
			},
			enableSorting: false,
			enableHiding: false,
			size: 48,
		});
	}

	return columns;
}

export { createExpenseColumns };

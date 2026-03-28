"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
	Banknote,
	Bell,
	CheckCircle2,
	Edit2,
	History,
	MoreHorizontal,
	Trash2,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { CategoryChip, NoCategoryLabel } from "~/components/category-chip";
import {
	PaymentMethodIcon,
	getPaymentMethodName,
} from "~/components/ui/payment-method-icon";
import { TransactionEditedIndicator } from "~/components/transaction-edited-indicator";
import { Badge } from "~/components/ui/badge";
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
import { TransactionStatusBadge } from "~/components/ui/transaction-status-badge";
import { formatExpenseDate } from "~/lib/format";
import { cn } from "~/lib/utils";

export type TimelineRow = {
	id: string;
	type: "transaction" | "settlement";
	date: Date;
	// Transaction fields (optional)
	description?: string;
	category?: { id: string; name: string; color: string; icon: string | null } | null;
	theirShare?: number;
	currency: string;
	amount?: number;
	paidBy?: { name: string; avatarUrl: string | null; isMe?: boolean };
	splitParticipants?: Array<{
		participantType: string;
		participantId: string;
		shareAmount: number;
		name: string;
		avatarUrl: string | null;
	}>;
	status: string;
	canEdit?: boolean;
	canDelete?: boolean;
	hasUnseenChanges?: boolean;
	project?: { id: string; name: string } | null;
	// Settlement fields
	direction?: "outgoing" | "incoming";
	settlementId?: string;
	paymentMethod?: string | null;
	note?: string | null;
	canConfirmSettlement?: boolean;
	canRejectSettlement?: boolean;
	canDeleteSettlement?: boolean;
	canRemindSettlement?: boolean;
};

export function createTimelineColumns(
	formatCurrency: (amount: number, currency: string) => string,
	identityName: string,
	callbacks: {
		onEdit: (txnId: string) => void;
		onDelete: (txn: {
			id: string;
			description: string;
			amount: number;
			currency: string;
			date: Date;
		}) => void;
		onViewHistory: (txnId: string) => void;
		onConfirmSettlement?: (id: string) => void;
		onRejectSettlement?: (id: string) => void;
		onDeleteSettlement?: (id: string) => void;
		onRemindSettlement?: (id: string) => void;
	},
	revisionSummaries?: Record<
		string,
		{
			editCount: number;
			lastEditedAt: string | null;
			lastEditedBy: string | null;
		}
	>,
): ColumnDef<TimelineRow>[] {
	return [
		{
			id: "description",
			header: "Title",
			enableSorting: true,
			meta: { flex: true },
			sortingFn: (rowA, rowB) => {
				const a = rowA.original.description ?? "";
				const b = rowB.original.description ?? "";
				return a.localeCompare(b);
			},
			cell: ({ row }) => {
				const item = row.original;
				if (item.type === "settlement") {
					const isIncoming = item.direction === "incoming";
					const directionLabel = isIncoming
						? `${identityName} paid you`
						: `You paid ${identityName}`;
					const methodName = item.paymentMethod
						? getPaymentMethodName(item.paymentMethod, null, item.currency)
						: null;
					return (
						<div className="flex items-center gap-2">
							{item.paymentMethod ? (
								<PaymentMethodIcon
									className="shrink-0"
									currency={item.currency}
									size="sm"
									typeId={item.paymentMethod}
								/>
							) : (
								<Banknote className="h-3.5 w-3.5 shrink-0 text-blue-500" />
							)}
							<span className="font-medium text-sm">
								Settlement
								{methodName && (
									<span className="text-muted-foreground font-normal">
										{" "}via {methodName}
									</span>
								)}
							</span>
							<span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 font-medium text-blue-700 text-xs ring-1 ring-blue-700/10 ring-inset dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/30">
								{directionLabel}
							</span>
						</div>
					);
				}

				const summary = revisionSummaries?.[item.id];
				const showIndicator = summary ?? item.hasUnseenChanges;

				return (
					<div className="flex items-center gap-2">
						<span className="font-medium text-sm">{item.description}</span>
						{item.project && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Link
										className="inline-flex cursor-pointer items-center rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-700 text-xs ring-1 ring-purple-700/10 ring-inset hover:bg-purple-100 dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/30 dark:hover:bg-purple-400/20"
										href={`/projects/${item.project.id}`}
										onClick={(e) => e.stopPropagation()}
									>
										{item.project.name}
									</Link>
								</TooltipTrigger>
								<TooltipContent align="start" side="top">
									<p>Open project: {item.project.name}</p>
								</TooltipContent>
							</Tooltip>
						)}
						{showIndicator && (
							<TransactionEditedIndicator
								editCount={summary?.editCount ?? 0}
								hasUnseenChanges={item.hasUnseenChanges ?? false}
								lastEditedAt={summary?.lastEditedAt ?? null}
								lastEditedBy={summary?.lastEditedBy ?? null}
								onClick={() => callbacks.onViewHistory(item.id)}
							/>
						)}
					</div>
				);
			},
		},
		{
			id: "category",
			header: "Category",
			enableSorting: true,
			size: 130,
			sortingFn: (rowA, rowB) => {
				const a = rowA.original.category?.name ?? "";
				const b = rowB.original.category?.name ?? "";
				return a.localeCompare(b);
			},
			cell: ({ row }) => {
				const item = row.original;
				if (item.type === "settlement") return null;
				if (!item.category) return <NoCategoryLabel />;
				return (
					<CategoryChip
						color={item.category.color}
						icon={item.category.icon}
						name={item.category.name}
					/>
				);
			},
		},
		{
			id: "split",
			header: "Who",
			enableSorting: false,
			size: 130,
			cell: ({ row }) => {
				const item = row.original;
				if (item.type === "settlement") return null;
				const participants = item.splitParticipants;
				if (!participants || participants.length === 0) {
					return <span className="text-muted-foreground">—</span>;
				}
				return (
					<AvatarStack
						currency={item.currency}
						formatCurrency={formatCurrency}
						participants={participants}
					/>
				);
			},
		},
		{
			accessorKey: "date",
			header: "Date",
			enableSorting: true,
			size: 110,
			sortingFn: (rowA, rowB) =>
				new Date(rowA.original.date).getTime() -
				new Date(rowB.original.date).getTime(),
			cell: ({ row }) => (
				<div className="whitespace-nowrap text-muted-foreground text-sm">
					{formatExpenseDate(new Date(row.original.date))}
				</div>
			),
		},
		{
			id: "theirShare",
			header: () => <div className="text-right">Amount</div>,
			enableSorting: true,
			size: 120,
			accessorFn: (row) => {
				if (row.type === "settlement") {
					return row.direction === "incoming"
						? (row.amount ?? 0)
						: -(row.amount ?? 0);
				}
				return row.theirShare ?? 0;
			},
			cell: ({ row }) => {
				const item = row.original;
				if (item.type === "settlement") {
					const isIncoming = item.direction === "incoming";
					return (
						<div
							className={cn(
								"text-right font-medium text-sm tabular-nums",
								isIncoming
									? "text-emerald-600 dark:text-emerald-400"
									: "text-rose-600 dark:text-rose-400",
							)}
						>
							{isIncoming ? "+" : "-"}
							{formatCurrency(item.amount ?? 0, item.currency)}
						</div>
					);
				}
				return (
					<div className="text-right font-medium text-sm tabular-nums">
						{formatCurrency(item.theirShare ?? 0, item.currency)}
					</div>
				);
			},
		},
		{
			id: "status",
			header: "Status",
			enableSorting: true,
			size: 100,
			sortingFn: (rowA, rowB) => {
				const a = rowA.original.status;
				const b = rowB.original.status;
				return a.localeCompare(b);
			},
			cell: ({ row }) => {
				const item = row.original;
				if (item.type === "settlement") {
					return (
						<Badge
							className={cn(
								"text-xs",
								item.status === "confirmed"
									? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
									: item.status === "rejected"
										? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
										: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
							)}
							variant="outline"
						>
							{item.status === "confirmed"
								? "Confirmed"
								: item.status === "rejected"
									? "Rejected"
									: "Pending"}
						</Badge>
					);
				}
				return <TransactionStatusBadge status={item.status} />;
			},
		},
		{
			id: "actions",
			header: () => null,
			enableSorting: false,
			enableHiding: false,
			size: 48,
			cell: ({ row }) => {
				const item = row.original;

				if (item.type === "settlement") {
					const hasActions =
						item.canConfirmSettlement ||
						item.canRejectSettlement ||
						item.canDeleteSettlement ||
						item.canRemindSettlement;
					if (!hasActions) return null;

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
							<DropdownMenuContent align="end" className="w-48">
								{item.canConfirmSettlement && item.settlementId && (
									<DropdownMenuItem
										onClick={() => callbacks.onConfirmSettlement?.(item.settlementId!)}
									>
										<CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
										Confirm Receipt
									</DropdownMenuItem>
								)}
								{item.canRejectSettlement && item.settlementId && (
									<DropdownMenuItem
										onClick={() => callbacks.onRejectSettlement?.(item.settlementId!)}
									>
										<XCircle className="mr-2 h-4 w-4 text-rose-500" />
										Reject
									</DropdownMenuItem>
								)}
								{item.canRemindSettlement && item.settlementId && (
									<DropdownMenuItem
										onClick={() => callbacks.onRemindSettlement?.(item.settlementId!)}
									>
										<Bell className="mr-2 h-4 w-4" />
										Send Reminder
									</DropdownMenuItem>
								)}
								{(item.canConfirmSettlement || item.canRejectSettlement || item.canRemindSettlement) &&
									item.canDeleteSettlement && <DropdownMenuSeparator />}
								{item.canDeleteSettlement && item.settlementId && (
									<DropdownMenuItem
										onClick={() => callbacks.onDeleteSettlement?.(item.settlementId!)}
										variant="destructive"
									>
										<Trash2 className="mr-2 h-4 w-4" />
										Cancel Settlement
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					);
				}

				const canEdit = item.canEdit && item.status !== "settled";
				const canDelete = item.canDelete && item.status !== "settled";

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
							<DropdownMenuItem
								onClick={() => callbacks.onViewHistory(item.id)}
							>
								<History className="mr-2 h-4 w-4" />
								View history
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={!canEdit}
								onClick={canEdit ? () => callbacks.onEdit(item.id) : undefined}
							>
								<Edit2 className="mr-2 h-4 w-4" />
								Edit
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={!canDelete}
								onClick={
									canDelete
										? () =>
												callbacks.onDelete({
													id: item.id,
													description: item.description ?? "",
													amount: item.amount ?? 0,
													currency: item.currency,
													date: new Date(item.date),
												})
										: undefined
								}
								variant={canDelete ? "destructive" : undefined}
							>
								<Trash2 className="mr-2 h-4 w-4" />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				);
			},
		},
	];
}

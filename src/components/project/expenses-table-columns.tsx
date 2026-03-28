"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CategoryChip, NoCategoryLabel } from "~/components/category-chip";
import { SharedTransactionActionsMenu } from "~/components/shared-transaction-actions-menu";
import { formatExpenseDate } from "~/lib/format";
import { TransactionEditedIndicator } from "~/components/transaction-edited-indicator";
import { TransactionStatusBadge } from "~/components/ui/transaction-status-badge";
import { AvatarStack } from "~/components/ui/avatar-stack";
import type { RouterOutputs } from "~/trpc/react";

export type ProjectExpense =
	RouterOutputs["project"]["listExpenses"]["transactions"][number];

interface ColumnOptions {
	isSolo?: boolean;
	isReadOnly?: boolean;
	formatCurrency: (amount: number, currency: string) => string;
	revisionSummaries?: Record<
		string,
		{
			editCount: number;
			lastEditedAt: string | null;
			lastEditedBy: string | null;
		}
	>;
	currentParticipant?: { type: string; id: string };
	onEdit?: (id: string) => void;
	onDelete?: (txn: {
		id: string;
		description: string;
		amount: number;
		currency: string;
		date: Date;
	}) => void;
	onViewHistory?: (id: string) => void;
	onAccept?: (txnId: string) => void;
	onReject?: (txnId: string) => void;
}

export function createProjectExpenseColumns({
	isSolo,
	isReadOnly,
	formatCurrency,
	revisionSummaries,
	currentParticipant,
	onEdit,
	onDelete,
	onViewHistory,
	onAccept,
	onReject,
}: ColumnOptions): ColumnDef<ProjectExpense>[] {
	const columns: ColumnDef<ProjectExpense>[] = [
		{
			accessorKey: "description",
			header: "Title",
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => {
				const txn = row.original;
				const summary = revisionSummaries?.[txn.id];
				const showIndicator = summary ?? txn.hasUnseenChanges;

				return (
					<div>
						<div className="font-medium">{txn.description}</div>
						{showIndicator && (
							<TransactionEditedIndicator
								editCount={summary?.editCount ?? 0}
								hasUnseenChanges={txn.hasUnseenChanges}
								lastEditedAt={summary?.lastEditedAt ?? null}
								lastEditedBy={summary?.lastEditedBy ?? null}
								onClick={() => onViewHistory?.(txn.id)}
							/>
						)}
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
				const a = rowA.original.category?.name ?? "";
				const b = rowB.original.category?.name ?? "";
				return a.localeCompare(b);
			},
		},
	];

	// Split column (group projects only)
	if (!isSolo) {
		columns.push({
			id: "split",
			header: "Who",
			enableSorting: false,
			size: 130,
			cell: ({ row }) => {
				const txn = row.original;
				return (
					<AvatarStack
						currency={txn.currency}
						formatCurrency={formatCurrency}
						participants={txn.splitParticipants ?? []}
					/>
				);
			},
		});
	}

	columns.push(
		{
			accessorKey: "date",
			header: "Date",
			enableSorting: true,
			size: 130,
			sortingFn: (rowA, rowB) =>
				new Date(rowA.original.date).getTime() -
				new Date(rowB.original.date).getTime(),
			cell: ({ row }) => (
				<div className="text-muted-foreground whitespace-nowrap">
					{formatExpenseDate(new Date(row.original.date))}
				</div>
			),
		},
		{
			id: "amount",
			header: () => <div className="text-right">Amount</div>,
			enableSorting: true,
			size: 140,
			accessorFn: (row) => row.amount,
			cell: ({ row }) => (
				<div className="text-right font-medium tabular-nums">
					{formatCurrency(row.original.amount, row.original.currency)}
				</div>
			),
		},
	);

	// Status column (group projects only)
	if (!isSolo) {
		columns.push({
			id: "status",
			header: "Status",
			enableSorting: false,
			size: 100,
			cell: ({ row }) => {
				const txn = row.original;
				const mySplit = currentParticipant
					? txn.splitParticipants?.find(
							(sp) =>
								sp.participantType === currentParticipant.type &&
								sp.participantId === currentParticipant.id,
						)
					: undefined;
				const isPending = mySplit?.verificationStatus === "PENDING";

				return (
					<div className="flex items-center gap-1.5">
						<TransactionStatusBadge status={txn.status} />
						{isPending && !txn.isLocked && onAccept && onReject && (
							<div className="flex items-center gap-0.5">
								<Button
									className="h-6 w-6 text-emerald-600 dark:text-emerald-400"
									onClick={(e) => {
										e.stopPropagation();
										onAccept(txn.id);
									}}
									size="icon"
									title="Accept"
									variant="ghost"
								>
									<Check className="h-3.5 w-3.5" />
								</Button>
								<Button
									className="h-6 w-6 text-rose-600 dark:text-rose-400"
									onClick={(e) => {
										e.stopPropagation();
										onReject(txn.id);
									}}
									size="icon"
									title="Reject"
									variant="ghost"
								>
									<X className="h-3.5 w-3.5" />
								</Button>
							</div>
						)}
					</div>
				);
			},
		});
	}

	// Actions column (authenticated view only)
	if (!isReadOnly) {
		columns.push({
			id: "actions",
			header: () => null,
			enableSorting: false,
			enableHiding: false,
			size: 48,
			cell: ({ row }) => {
				const txn = row.original;
				const mySplitForActions = currentParticipant
					? txn.splitParticipants?.find(
							(sp) =>
								sp.participantType === currentParticipant.type &&
								sp.participantId === currentParticipant.id,
						)
					: undefined;
				const isPending =
					mySplitForActions?.verificationStatus === "PENDING" && !txn.isLocked;

				return (
					<SharedTransactionActionsMenu
						canDelete={txn.canDelete}
						canEdit={txn.canEdit}
						isLocked={txn.isLocked}
						isPendingReview={isPending}
						onAccept={isPending ? () => onAccept?.(txn.id) : undefined}
						onReject={isPending ? () => onReject?.(txn.id) : undefined}
						onDelete={() =>
							onDelete?.({
								id: txn.id,
								description: txn.description,
								amount: txn.amount,
								currency: txn.currency,
								date: new Date(txn.date),
							})
						}
						onEdit={() => onEdit?.(txn.id)}
						onViewHistory={() => onViewHistory?.(txn.id)}
						triggerClassName="md:opacity-0 transition-opacity md:group-hover:opacity-100 focus-within:opacity-100"
					/>
				);
			},
		});
	}

	return columns;
}

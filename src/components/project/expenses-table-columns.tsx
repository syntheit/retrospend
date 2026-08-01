"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, MoreHorizontal, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CategoryChip, NoCategoryLabel } from "~/components/category-chip";
import { SharedTransactionActionsMenu } from "~/components/shared-transaction-actions-menu";
import { formatExpenseAsText, formatExpenseDate } from "~/lib/format";
import { TransactionStatusBadge } from "~/components/ui/transaction-status-badge";
import { AvatarStack } from "~/components/ui/avatar-stack";
import type { RouterOutputs } from "~/trpc/react";

export type ProjectExpense =
	RouterOutputs["project"]["listExpenses"]["transactions"][number];

interface ColumnOptions {
	isSolo?: boolean;
	isReadOnly?: boolean;
	formatCurrency: (amount: number, currency: string) => string;
	t?: (key: string) => string;
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
	locale?: string;
	/** True on mobile — the actions column then renders a "⋯" that opens the sheet. */
	isMobile?: boolean;
	/**
	 * Open the mobile detail/actions sheet for a transaction. When provided and
	 * `isMobile` is true, the actions column shows a single "⋯" trigger that opens
	 * the sheet instead of the desktop dropdown.
	 */
	onOpenSheet?: (id: string) => void;
}

export function createProjectExpenseColumns({
	isSolo,
	isReadOnly,
	formatCurrency,
	t,
	currentParticipant,
	onEdit,
	onDelete,
	onViewHistory,
	onAccept,
	onReject,
	locale,
	isMobile,
	onOpenSheet,
}: ColumnOptions): ColumnDef<ProjectExpense>[] {
	const label = (key: string) => t?.(key) ?? key;
	const columns: ColumnDef<ProjectExpense>[] = [
		{
			accessorKey: "description",
			header: label("columnTitle"),
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => {
				const txn = row.original;
				// The inline "edited" tag was removed; revision history is reachable
				// from the row actions menu (View history).
				return (
					<div>
						<div className="font-medium">{txn.description}</div>
					</div>
				);
			},
		},
		{
			accessorKey: "category",
			header: label("columnCategory"),
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
			header: label("columnWho"),
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
			header: label("columnDate"),
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
			header: () => <div className="text-right">{label("columnAmount")}</div>,
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
			header: label("columnStatus"),
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

				// On mobile, the actions column is a single "⋯" tap target that opens
				// the shared detail/actions sheet (details + gated actions). Desktop
				// keeps the dropdown menu; the right-click context menu is unchanged.
				if (isMobile && onOpenSheet) {
					return (
						<Button
							className="h-8 w-8"
							onClick={(e) => {
								e.stopPropagation();
								onOpenSheet(txn.id);
							}}
							size="icon"
							variant="ghost"
						>
							<MoreHorizontal className="h-4 w-4" />
							<span className="sr-only">{label("actions")}</span>
						</Button>
					);
				}

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
						copyText={formatExpenseAsText(
							txn.description,
							txn.amount,
							txn.currency,
							new Date(txn.date),
							formatCurrency,
							locale,
						)}
						triggerClassName="md:opacity-0 transition-opacity md:group-hover:opacity-100 focus-within:opacity-100"
					/>
				);
			},
		});
	}

	return columns;
}

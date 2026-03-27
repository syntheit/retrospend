"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { UserAvatar } from "~/components/ui/user-avatar";
import { formatExpenseDate } from "~/lib/format";

export type ActivityTableRow = {
	id: string;
	type: "shared" | "settlement";
	description: string;
	personName: string;
	personAvatarUrl?: string | null;
	projectName?: string | null;
	projectId?: string | null;
	date: Date;
	amount: number;
	currency: string;
	direction: "they_owe_you" | "you_owe_them" | "settlement";
	/** For row click navigation */
	personHref?: string;
};

export function createActivityColumns(
	formatCurrency: (amount: number, currency: string) => string,
): ColumnDef<ActivityTableRow>[] {
	return [
		{
			id: "description",
			header: "Title",
			enableSorting: true,
			meta: { flex: true },
			sortingFn: (rowA, rowB) => {
				return rowA.original.description.localeCompare(
					rowB.original.description,
				);
			},
			cell: ({ row }) => {
				const item = row.original;
				return (
					<div className="flex items-center gap-2">
						<UserAvatar
							avatarUrl={item.personAvatarUrl}
							className="h-5 w-5 text-[9px]"
							name={item.personName}
							size="xs"
						/>
						<div className="font-medium">{item.description}</div>
						{item.projectName && (
							<Tooltip>
								<TooltipTrigger asChild>
									{item.projectId ? (
										<Link
											className="inline-flex cursor-pointer items-center rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-700 text-xs ring-1 ring-purple-700/10 ring-inset hover:bg-purple-100 dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/30 dark:hover:bg-purple-400/20"
											href={`/projects/${item.projectId}`}
											onClick={(e) => e.stopPropagation()}
										>
											{item.projectName}
										</Link>
									) : (
										<span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-700 text-xs ring-1 ring-purple-700/10 ring-inset dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/30">
											{item.projectName}
										</span>
									)}
								</TooltipTrigger>
								<TooltipContent align="start" side="top">
									<p>Open project: {item.projectName}</p>
								</TooltipContent>
							</Tooltip>
						)}
					</div>
				);
			},
		},
		{
			accessorKey: "date",
			header: "Date",
			enableSorting: true,
			size: 130,
			sortingFn: (rowA, rowB) =>
				new Date(rowA.original.date).getTime() -
				new Date(rowB.original.date).getTime(),
			cell: ({ row }) => (
				<div className="text-muted-foreground">
					{formatExpenseDate(new Date(row.original.date))}
				</div>
			),
		},
		{
			id: "amount",
			header: () => <div className="text-right">Amount</div>,
			enableSorting: true,
			size: 120,
			accessorFn: (row) => row.amount,
			cell: ({ row }) => {
				const item = row.original;
				return (
					<div className="text-right font-medium tabular-nums">
						{formatCurrency(item.amount, item.currency)}
					</div>
				);
			},
		},
		{
			id: "directionLabel",
			header: "Type",
			enableSorting: false,
			size: 100,
			cell: ({ row }) => {
				const d = row.original.direction;
				const label =
					d === "they_owe_you"
						? "they owe you"
						: d === "you_owe_them"
							? "you owe them"
							: "settlement";
				return (
					<span className="text-muted-foreground text-xs">
						{label}
					</span>
				);
			},
		},
	];
}

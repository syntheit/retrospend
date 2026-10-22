"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";
import type { DataTableColumnDef } from "~/components/data-table-features";
import { useRowDates } from "~/components/rows/dates";
import {
	TransactionAmount,
	TransactionLead,
	TransactionStatus,
	TransactionWith,
	useKindWord,
} from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { Checkbox } from "~/components/ui/checkbox";
import { MONEY_CELL } from "./table-style";

type Selection = {
	selected: Set<string>;
	onToggle: (id: string, checked: boolean) => void;
	onToggleAll: (checked: boolean) => void;
};

/**
 * The Activity columns (desktop): select, Title, Category, Project, With,
 * Date, Amount and the ⋯ column. Cells are the TransactionRow pieces, so the
 * table and the phone rows show one anatomy (R18). Identity columns have
 * fixed widths so faces start on one edge (R27).
 */
export function useTransactionColumns({
	selection,
	today,
	hideProject = false,
	actions,
}: {
	selection?: Selection;
	today?: string;
	hideProject?: boolean;
	actions?: (tx: TransactionVM) => ReactNode;
}) {
	const t = useTranslations("rows.table");
	const kindWord = useKindWord();
	const { day } = useRowDates(today);
	return useMemo(() => {
		const cols: DataTableColumnDef<TransactionVM>[] = [];
		if (selection)
			cols.push({
				id: "select",
				size: 40,
				enableSorting: false,
				meta: { className: "w-10 pr-0" },
				header: ({ table }) => {
					const ids = table.getRowModel().rows.map((r) => r.original.id);
					const all =
						ids.length > 0 && ids.every((id) => selection.selected.has(id));
					return (
						<Checkbox
							aria-label={t("selectAll")}
							checked={all}
							onCheckedChange={(v) => selection.onToggleAll(v === true)}
						/>
					);
				},
				cell: ({ row }) => (
					<Checkbox
						aria-label={t("select", { title: row.original.title })}
						checked={selection.selected.has(row.original.id)}
						onCheckedChange={(v) =>
							selection.onToggle(row.original.id, v === true)
						}
					/>
				),
			});
		cols.push(
			{
				id: "title",
				accessorKey: "title",
				header: t("title"),
				meta: { flex: true },
				cell: ({ row }) => {
					const tx = row.original;
					const word = kindWord(tx);
					return (
						<span className="flex min-w-0 items-center gap-2">
							<span className="text-fg truncate">{tx.title}</span>
							<TransactionStatus tx={tx} />
							{word && <span className="text-fg-3 text-meta">{word}</span>}
						</span>
					);
				},
			},
			{
				id: "category",
				accessorFn: (tx) => tx.category?.name ?? "",
				header: t("category"),
				size: 148,
				cell: ({ row }) => (
					<span className="text-fg-2 flex items-center gap-2">
						<TransactionLead size="sm" tx={row.original} />
						{row.original.category?.name ?? kindWord(row.original)}
					</span>
				),
			},
		);
		if (!hideProject)
			cols.push({
				id: "project",
				accessorFn: (tx) => tx.project?.name ?? "",
				header: t("project"),
				size: 150,
				cell: ({ row }) =>
					row.original.project ? (
						<span className="text-fg-2 block max-w-40 truncate">
							{row.original.project.name}
						</span>
					) : null,
			});
		cols.push(
			{
				id: "with",
				header: t("with"),
				size: 150,
				enableSorting: false,
				cell: ({ row }) => <TransactionWith tx={row.original} />,
			},
			{
				id: "date",
				accessorKey: "date",
				header: t("date"),
				size: 120,
				meta: { className: "text-fg-2" },
				cell: ({ row }) => day(row.original.date),
			},
			{
				id: "amount",
				accessorFn: (tx) => tx.amount.minor,
				header: t("amount"),
				size: 140,
				meta: { className: MONEY_CELL, align: "right" },
				cell: ({ row }) => (
					<span className="ml-auto">
						<TransactionAmount tx={row.original} />
					</span>
				),
			},
		);
		if (actions)
			cols.push({
				id: "actions",
				size: 40,
				enableSorting: false,
				header: () => <span className="sr-only">{t("actions")}</span>,
				meta: { className: "w-trail" },
				cell: ({ row }) => (
					<span className="can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:focus-within:opacity-100 ml-auto">
						{actions(row.original)}
					</span>
				),
			});
		return cols;
	}, [selection, hideProject, actions, t, kindWord, day]);
}

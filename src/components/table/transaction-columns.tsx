"use client";

import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useMemo } from "react";
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
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { MONEY_CELL } from "./table-style";

export type Selection = {
	selected: Set<string>;
	onToggle: (id: string, checked: boolean) => void;
	onToggleAll: (checked: boolean) => void;
};

/**
 * Selection reaches the checkbox cells through context, so toggling a row
 * re-renders that row and the header box, not the column definitions (the
 * engine re-renders every row when its columns change).
 */
export const SelectionContext = createContext<Selection | null>(null);

function SelectAll({ ids }: { ids: string[] }) {
	const t = useTranslations("rows.table");
	const s = useContext(SelectionContext);
	if (!s) return null;
	const all = ids.length > 0 && ids.every((id) => s.selected.has(id));
	return (
		<Checkbox
			aria-label={t("selectAll")}
			checked={all}
			onCheckedChange={(v) => s.onToggleAll(v === true)}
		/>
	);
}

function SelectOne({ tx }: { tx: TransactionVM }) {
	const t = useTranslations("rows.table");
	const s = useContext(SelectionContext);
	if (!s) return null;
	return (
		<Checkbox
			aria-label={t("select", { title: tx.title })}
			checked={s.selected.has(tx.id)}
			onCheckedChange={(v) => s.onToggle(tx.id, v === true)}
		/>
	);
}

/** The title as the row's open button (keyboard and screen readers), or plain text. */
function Title({
	tx,
	onOpen,
}: {
	tx: TransactionVM;
	onOpen?: (tx: TransactionVM) => void;
}) {
	if (!onOpen) return <span className="text-fg truncate">{tx.title}</span>;
	return (
		<Button
			className="text-body text-fg can-hover:hover:bg-transparent can-hover:hover:text-fg h-auto min-w-0 shrink justify-start border-0 px-0 font-normal"
			kind="ghost"
			onClick={() => onOpen(tx)}
		>
			<span className="truncate">{tx.title}</span>
		</Button>
	);
}

/** A small project cover in its slot, a flat tile until the project has one. */
function ProjectCell({
	project,
}: {
	project: NonNullable<TransactionVM["project"]>;
}) {
	return (
		<span className="text-fg-2 flex max-w-40 items-center gap-2">
			<span
				aria-hidden="true"
				className="bg-raised rounded-ctl flex size-6 shrink-0 overflow-hidden *:size-full"
			>
				{project.cover}
			</span>
			<span className="truncate">{project.name}</span>
		</span>
	);
}

/**
 * The Activity columns (desktop): select, Title, Category, Project, With,
 * Date, Amount and the ⋯ column. Cells are the TransactionRow pieces, so the
 * table and the phone rows show one anatomy (R18). Identity columns have
 * fixed widths so faces start on one edge (R27). The amount sorts on the
 * server's home-currency sort key, never native minor units across
 * currencies; rows without a rate sort last either way.
 */
export function useTransactionColumns({
	selectable,
	today,
	hideProject = false,
	actions,
	onOpen,
}: {
	selectable: boolean;
	today?: string;
	hideProject?: boolean;
	actions?: (tx: TransactionVM) => ReactNode;
	onOpen?: (tx: TransactionVM) => void;
}) {
	const t = useTranslations("rows.table");
	const kindWord = useKindWord();
	const { day } = useRowDates(today);
	return useMemo(() => {
		const cols: DataTableColumnDef<TransactionVM>[] = [];
		if (selectable)
			cols.push({
				id: "select",
				size: 40,
				enableSorting: false,
				meta: { className: "w-10 pr-0" },
				header: ({ table }) => (
					<SelectAll ids={table.getRowModel().rows.map((r) => r.original.id)} />
				),
				cell: ({ row }) => <SelectOne tx={row.original} />,
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
							<Title onOpen={onOpen} tx={tx} />
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
						<ProjectCell project={row.original.project} />
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
				accessorFn: (tx) => tx.sortKey ?? undefined,
				sortFn: "basic",
				sortUndefined: "last",
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
					<span className="can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:group-focus-visible:opacity-100 can-hover:focus-within:opacity-100 ml-auto">
						{actions(row.original)}
					</span>
				),
			});
		return cols;
	}, [selectable, hideProject, actions, onOpen, t, kindWord, day]);
}

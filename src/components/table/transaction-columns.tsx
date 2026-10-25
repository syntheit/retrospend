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
import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status-dot";
import { fitColumns } from "./column-fit";
import { selectColumn } from "./select-column";
import { MONEY_CELL } from "./table-style";

const CATEGORY_SIZE = 148;
const PROJECT_SIZE = 150;
const WITH_SIZE = 150;
const AMOUNT_SIZE = 140;
const SELECT_SIZE = 40;
const ACTIONS_SIZE = 40;

/** The trailing ⋯ column: hover-revealed on fine pointers, always there for focus. */
export function actionsColumn(
	actions: (tx: TransactionVM) => ReactNode,
	label: string,
): DataTableColumnDef<TransactionVM> {
	return {
		id: "actions",
		size: 40,
		enableSorting: false,
		header: () => <span className="sr-only">{label}</span>,
		meta: { className: "w-trail" },
		cell: ({ row }) => (
			<span className="can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:group-focus-visible:opacity-100 can-hover:focus-within:opacity-100 ml-auto">
				{actions(row.original)}
			</span>
		),
	};
}

/** The title as the row's open button (keyboard and screen readers), or plain text. */
export function Title({
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

/**
 * What the title cell says after the title: the review statuses, then the
 * kind word. When the category column already names the kind (a payment,
 * a transfer), only "Pending" is left to say, so nothing shows twice.
 */
export function TitleWords({ tx }: { tx: TransactionVM }) {
	const kindWord = useKindWord();
	const word = tx.category ? kindWord(tx) : null;
	return (
		<>
			<TransactionStatus tx={tx} />
			{word && <span className="text-fg-3 text-meta">{word}</span>}
			{!tx.category && tx.pending && <StatusDot kind="pending" size="sm" />}
		</>
	);
}

/** A small project cover in its slot, a flat tile until the project has one. */
export function ProjectCell({
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
 * The Date column; left out when day rows carry the date (layout A). A
 * ledger under month rows says the short day ("Oct 21", person.html).
 */
export function useDateColumn(today?: string, style: "day" | "short" = "day") {
	const t = useTranslations("rows.table");
	const { day, short } = useRowDates(today);
	return useMemo(
		(): DataTableColumnDef<TransactionVM> => ({
			id: "date",
			accessorKey: "date",
			header: t("date"),
			size: style === "short" ? 80 : 120,
			meta: { className: "text-fg-2" },
			cell: ({ row }) =>
				style === "short" ? short(row.original.date) : day(row.original.date),
		}),
		[t, day, short, style],
	);
}

/**
 * The Activity columns (desktop): select, Title, Category, Project, With,
 * Date, Amount and the ⋯ column. Cells are the TransactionRow pieces, so the
 * table and the phone rows show one anatomy (R18). Identity columns have
 * fixed widths so faces start on one edge (R27). The amount sorts on the
 * server's home-currency sort key, never native minor units across
 * currencies; rows without a rate sort last either way. Given the table's
 * width (`space`), With, Project and Category drop in that order, so Title
 * keeps a usable width at tablet widths (column-fit.ts).
 */
export function useTransactionColumns({
	selectable,
	today,
	hideProject = false,
	hideDate = false,
	space = null,
	sortable = true,
	actions,
	onOpen,
}: {
	selectable: boolean;
	today?: string;
	hideProject?: boolean;
	hideDate?: boolean;
	/** The table's width in pixels; null until measured (every column). */
	space?: number | null;
	sortable?: boolean;
	actions?: (tx: TransactionVM) => ReactNode;
	onOpen?: (tx: TransactionVM) => void;
}) {
	const t = useTranslations("rows.table");
	const kinds = useTranslations("rows.kind");
	const date = useDateColumn(today);
	const fixed =
		AMOUNT_SIZE +
		(selectable ? SELECT_SIZE : 0) +
		(actions ? ACTIONS_SIZE : 0) +
		(hideDate ? 0 : (date.size ?? 0));
	const shown = useMemo(
		() =>
			fitColumns(space, fixed, [
				{ id: "category", size: CATEGORY_SIZE },
				...(hideProject ? [] : [{ id: "project", size: PROJECT_SIZE }]),
				{ id: "with", size: WITH_SIZE },
			]),
		[space, fixed, hideProject],
	);
	return useMemo(() => {
		const cols: DataTableColumnDef<TransactionVM>[] = [];
		if (selectable) cols.push(selectColumn());
		cols.push(
			{
				id: "title",
				accessorKey: "title",
				header: t("title"),
				meta: { flex: true, className: "w-full max-w-0 min-w-48" },
				cell: ({ row }) => (
					<span className="flex min-w-0 items-center gap-2">
						<Title onOpen={onOpen} tx={row.original} />
						<TitleWords tx={row.original} />
					</span>
				),
			},
		);
		if (shown.has("category"))
			cols.push({
				id: "category",
				accessorFn: (tx) => tx.category?.name ?? "",
				header: t("category"),
				size: CATEGORY_SIZE,
				cell: ({ row }) => {
					const tx = row.original;
					return (
						<span className="text-fg-2 flex items-center gap-2">
							<TransactionLead size="sm" tx={tx} />
							{tx.category?.name ??
								(tx.kind === "expense" ? null : kinds(tx.kind))}
						</span>
					);
				},
			});
		if (!hideProject && shown.has("project"))
			cols.push({
				id: "project",
				accessorFn: (tx) => tx.project?.name ?? "",
				header: t("project"),
				size: PROJECT_SIZE,
				cell: ({ row }) =>
					row.original.project ? (
						<ProjectCell project={row.original.project} />
					) : null,
			});
		if (shown.has("with"))
			cols.push({
				id: "with",
				header: t("with"),
				size: WITH_SIZE,
				enableSorting: false,
				cell: ({ row }) => <TransactionWith tx={row.original} />,
			});
		if (!hideDate) cols.push(date);
		cols.push({
			id: "amount",
			accessorFn: (tx) => tx.sortKey ?? undefined,
			sortFn: "basic",
			sortUndefined: "last",
			header: t("amount"),
			size: AMOUNT_SIZE,
			meta: { className: MONEY_CELL, align: "right" },
			cell: ({ row }) => (
				<span className="ml-auto">
					<TransactionAmount tx={row.original} />
				</span>
			),
		});
		if (actions) cols.push(actionsColumn(actions, t("actions")));
		if (!sortable) for (const c of cols) c.enableSorting = false;
		return cols;
	}, [
		selectable,
		hideProject,
		hideDate,
		shown,
		sortable,
		actions,
		onOpen,
		t,
		kinds,
		date,
	]);
}

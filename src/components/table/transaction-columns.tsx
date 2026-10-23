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
import { StatusDot } from "~/components/ui/status-dot";
import { MONEY_CELL } from "./table-style";

export type Selection = {
	selected: ReadonlySet<string>;
	/** Rows that can be selected; the others keep a disabled box (§5). */
	canSelect: (tx: TransactionVM) => boolean;
	onToggle: (id: string, checked: boolean, range?: string[]) => void;
	onToggleAll: (ids: string[], checked: boolean) => void;
};

/**
 * Selection reaches the checkbox cells through context, so toggling a row
 * re-renders that row and the header box, not the column definitions (the
 * engine re-renders every row when its columns change).
 */
export const SelectionContext = createContext<Selection | null>(null);

/** The table's rows in the order shown (sorting applied). */
type Shown = { getRowModel: () => { rows: { original: TransactionVM }[] } };
const shownRows = (table: Shown) =>
	table.getRowModel().rows.map((r) => r.original);

function SelectAll({ table }: { table: Shown }) {
	const t = useTranslations("rows.table");
	const s = useContext(SelectionContext);
	if (!s) return null;
	const ids = shownRows(table)
		.filter(s.canSelect)
		.map((r) => r.id);
	const all = ids.length > 0 && ids.every((id) => s.selected.has(id));
	return (
		<Checkbox
			aria-label={t("selectAll")}
			checked={all}
			disabled={ids.length === 0}
			onCheckedChange={(v) => s.onToggleAll(ids, v === true)}
		/>
	);
}

/** A row's box. Shift-click selects the run from the last box clicked (R13 desktop). */
function SelectOne({ tx, table }: { tx: TransactionVM; table: Shown }) {
	const t = useTranslations("rows.table");
	const s = useContext(SelectionContext);
	if (!s) return null;
	return (
		<Checkbox
			aria-label={t("select", { title: tx.title })}
			checked={s.selected.has(tx.id)}
			disabled={!s.canSelect(tx)}
			onClick={(e) => {
				if (!e.shiftKey) return;
				e.preventDefault();
				s.onToggle(
					tx.id,
					true,
					shownRows(table)
						.filter(s.canSelect)
						.map((r) => r.id),
				);
			}}
			onCheckedChange={(v) => s.onToggle(tx.id, v === true)}
		/>
	);
}

/** The select column, present whenever the list can select (disabled rows keep it). */
export function selectColumn(): DataTableColumnDef<TransactionVM> {
	return {
		id: "select",
		size: 40,
		enableSorting: false,
		meta: { className: "w-10 pr-0" },
		header: ({ table }) => <SelectAll table={table} />,
		cell: ({ row, table }) => <SelectOne table={table} tx={row.original} />,
	};
}

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
 * currencies; rows without a rate sort last either way.
 */
export function useTransactionColumns({
	selectable,
	today,
	hideProject = false,
	hideDate = false,
	sortable = true,
	actions,
	onOpen,
}: {
	selectable: boolean;
	today?: string;
	hideProject?: boolean;
	hideDate?: boolean;
	sortable?: boolean;
	actions?: (tx: TransactionVM) => ReactNode;
	onOpen?: (tx: TransactionVM) => void;
}) {
	const t = useTranslations("rows.table");
	const kinds = useTranslations("rows.kind");
	const date = useDateColumn(today);
	return useMemo(() => {
		const cols: DataTableColumnDef<TransactionVM>[] = [];
		if (selectable) cols.push(selectColumn());
		cols.push(
			{
				id: "title",
				accessorKey: "title",
				header: t("title"),
				// The title takes the room left and truncates, so long titles never widen the table.
				meta: { flex: true, className: "w-full max-w-0" },
				cell: ({ row }) => (
					<span className="flex min-w-0 items-center gap-2">
						<Title onOpen={onOpen} tx={row.original} />
						<TitleWords tx={row.original} />
					</span>
				),
			},
			{
				id: "category",
				accessorFn: (tx) => tx.category?.name ?? "",
				header: t("category"),
				size: 148,
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
		cols.push({
			id: "with",
			header: t("with"),
			size: 150,
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
			size: 140,
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
		sortable,
		actions,
		onOpen,
		t,
		kinds,
		date,
	]);
}

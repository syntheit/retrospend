"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import type { DataTableColumnDef } from "~/components/data-table-features";
import type { TransactionVM } from "~/components/rows/types";
import { Checkbox } from "~/components/ui/checkbox";

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

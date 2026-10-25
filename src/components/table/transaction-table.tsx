"use client";

import { useTranslations } from "next-intl";
import {
	type ReactElement,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { DataTable } from "~/components/data-table";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import type { TransactionVM } from "~/components/rows/types";
import { TableCell, TableRow } from "~/components/ui/table";
import { BulkBar } from "./bulk-bar";
import { useElementWidth } from "./column-fit";
import { type TableGroups, withGroupRows } from "./group-rows";
import { type LedgerColumns, useLedgerColumns } from "./ledger-columns";
import { type Selection, SelectionContext } from "./select-column";
import { TABLE_LOOK } from "./table-style";
import { useTransactionColumns } from "./transaction-columns";

/** The footer total, computed by the server for the rows the filter shows (R9). */
export type TableTotal = {
	/** The figures registry key ("spent"). */
	figure?: string;
	count: number;
	total: MoneyValue;
	/** Rows left out of the total because they have no rate yet. */
	withoutRate?: number;
};

/**
 * The selection, held by the page when it acts on it (the bulk bar);
 * otherwise the table keeps its own.
 */
export type TableSelection = {
	selected: ReadonlySet<string>;
	onChange: (ids: Set<string>) => void;
};

const ALL = () => true;

/** Selection state: the page's when it passes one, else the table's own. */
function useSelection(
	rows: TransactionVM[],
	controlled: TableSelection | undefined,
	canSelect: (tx: TransactionVM) => boolean,
) {
	const [own, setOwn] = useState<ReadonlySet<string>>(() => new Set());
	const [anchor, setAnchor] = useState<string | null>(null);
	const selected = controlled?.selected ?? own;
	const set = controlled?.onChange ?? setOwn;
	const onToggle = useCallback(
		(id: string, checked: boolean, range?: string[]) => {
			const next = new Set(selected);
			const from = anchor ? (range?.indexOf(anchor) ?? -1) : -1;
			const to = range?.indexOf(id) ?? -1;
			if (range && from >= 0 && to >= 0) {
				for (const r of range.slice(Math.min(from, to), Math.max(from, to) + 1))
					next.add(r);
			} else if (checked) next.add(id);
			else next.delete(id);
			set(next);
			setAnchor(id);
		},
		[selected, anchor, set],
	);
	const onToggleAll = useCallback(
		(ids: string[], checked: boolean) =>
			set(checked ? new Set(ids) : new Set()),
		[set],
	);
	const context: Selection = useMemo(
		() => ({ selected, canSelect, onToggle, onToggleAll }),
		[selected, canSelect, onToggle, onToggleAll],
	);
	const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
	// Rows that left the list (deleted, filtered out) leave the selection.
	const live = useMemo(
		() => new Set([...selected].filter((id) => ids.has(id))),
		[selected, ids],
	);
	return {
		context,
		live,
		anchor,
		clear: () => set(new Set()),
		range: (r: string[]) => set(new Set(r)),
	};
}

/**
 * TransactionTable: a desktop list of entries (R13: never on a phone) on
 * the shared DataTable engine (TanStack, sorting, keyboard) with the
 * TransactionRow pieces as cells. Activity's columns by default; `ledger`
 * picks a project's or a person's. `groups` adds day or month rows with
 * their totals (layout A drops the Date column and keeps the server's
 * order). With `bulk`, a selection shows the bulk bar over the table. The
 * footer says what it sums ("Your spending") and shows the server's total.
 */
export function TransactionTable({
	rows,
	total,
	today,
	hideProject,
	ledger,
	solo,
	groups,
	selectable = true,
	canSelect = ALL,
	selection,
	bulk,
	actions,
	rowArea,
	onOpen,
	empty,
	sort,
	className,
}: {
	rows: TransactionVM[];
	total?: TableTotal;
	/** ISO date of today, for "Today" and "Yesterday". */
	today?: string;
	hideProject?: boolean;
	/** A project's or a person's columns instead of Activity's. */
	ledger?: LedgerColumns;
	/** A solo project: no Paid by, Split or Your share. */
	solo?: boolean;
	groups?: TableGroups;
	selectable?: boolean;
	/** Rows that can be selected; the others keep a disabled box. */
	canSelect?: (tx: TransactionVM) => boolean;
	selection?: TableSelection;
	/** The bulk actions for the selected ids (BulkAction buttons). */
	bulk?: (ids: string[], clear: () => void) => ReactNode;
	/** The ⋯ button per row, from the action registry (R8). */
	actions?: (tx: TransactionVM) => ReactNode;
	/**
	 * Wraps each row in its ActionArea, so right-click and long press open
	 * the same registry menu as the ⋯ button.
	 */
	rowArea?: (tx: TransactionVM, tr: ReactElement) => ReactElement;
	onOpen?: (tx: TransactionVM) => void;
	/** EmptyState for no rows, or no matches with Clear filters. */
	empty?: ReactNode;
	/** The starting sort, as column ids ("amount", "date"); the header changes it. */
	sort?: { id: string; desc: boolean }[];
	className?: string;
}) {
	const t = useTranslations("rows.table");
	const sel = useSelection(rows, selection, canSelect);
	const byDay = groups?.by === "day";
	const shape = {
		selectable,
		today,
		hideDate: byDay,
		sortable: !groups,
		actions,
		onOpen,
	};
	const panel = useRef<HTMLDivElement>(null);
	const space = useElementWidth(panel);
	const activity = useTransactionColumns({ ...shape, hideProject, space });
	const ledgerCols = useLedgerColumns({
		...shape,
		set: ledger ?? "project",
		solo,
	});
	const columns = ledger ? ledgerCols : activity;
	const span = columns.length;
	// The footer's total sits under the amount column, whatever follows it.
	const amountAt = columns.findIndex((c) => c.id === "amount");
	const after = span - amountAt - 1;
	const ids = [...sel.live];
	return (
		<div className={className} data-slot="transaction-table">
			{bulk && (
				<BulkBar count={ids.length} onClear={sel.clear}>
					{bulk(ids, sel.clear)}
				</BulkBar>
			)}
			<div className={TABLE_LOOK} ref={panel}>
				<SelectionContext.Provider value={sel.context}>
					<DataTable
						columns={columns}
						data={rows}
						emptyState={empty}
						footer={
							total && (
								<TableRow>
									{selectable && <TableCell />}
									<TableCell colSpan={amountAt - (selectable ? 1 : 0)}>
										{t("yourSpending")}{" "}
										<span className="text-fg-3 text-meta font-normal">
											{t("count", { count: total.count })}
											{total.withoutRate
												? ` · ${t("withoutRate", { count: total.withoutRate })}`
												: null}
										</span>
									</TableCell>
									<TableCell className="text-right">
										<Money figure={total.figure} value={total.total} />
									</TableCell>
									{after > 0 && <TableCell colSpan={after} />}
								</TableRow>
							)
						}
						hideCount
						initialSorting={groups ? undefined : sort}
						lastSelectedId={sel.anchor}
						onClearSelection={sel.clear}
						onEditRow={(id) => {
							const tx = rows.find((r) => r.id === id);
							if (tx) onOpen?.(tx);
						}}
						onRangeSelect={selectable ? sel.range : undefined}
						onRowClick={onOpen}
						onRowOpen={onOpen}
						renderTableBodyContent={
							groups
								? (children) =>
										withGroupRows(
											children,
											groups,
											span - (actions ? 1 : 0),
											!!actions,
										)
								: undefined
						}
						rowClassName={(row) =>
							row.original.kind === "expense" ? undefined : "text-fg-2"
						}
						searchable={false}
						selectedRows={sel.live}
						wrapRow={rowArea}
					/>
				</SelectionContext.Provider>
			</div>
		</div>
	);
}

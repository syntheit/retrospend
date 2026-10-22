"use client";

import { useTranslations } from "next-intl";
import {
	type ReactElement,
	type ReactNode,
	useCallback,
	useMemo,
	useState,
} from "react";
import { DataTable } from "~/components/data-table";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import type { TransactionVM } from "~/components/rows/types";
import { TableCell, TableRow } from "~/components/ui/table";
import { cn } from "~/lib/cn";
import { TABLE_LOOK } from "./table-style";
import { SelectionContext, useTransactionColumns } from "./transaction-columns";

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
 * TransactionTable: Activity on desktop (R13: never on a phone). It runs on
 * the shared DataTable engine (TanStack, sorting, click and shift-click
 * selection, keyboard) with the TransactionRow pieces as cells. The footer
 * says what it sums ("Your spending") and shows the server's total.
 */
export function TransactionTable({
	rows,
	total,
	today,
	hideProject,
	selectable = true,
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
	selectable?: boolean;
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
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [anchor, setAnchor] = useState<string | null>(null);
	const onToggle = useCallback((id: string, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
		setAnchor(id);
	}, []);
	const onToggleAll = useCallback(
		(checked: boolean) =>
			setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set()),
		[rows],
	);
	const selection = useMemo(
		() => ({ selected, onToggle, onToggleAll }),
		[selected, onToggle, onToggleAll],
	);
	const columns = useTransactionColumns({
		selectable,
		today,
		hideProject,
		actions,
		onOpen,
	});
	const span = columns.length;
	return (
		<div className={cn(TABLE_LOOK, className)} data-slot="transaction-table">
			<SelectionContext.Provider value={selection}>
				<DataTable
					columns={columns}
					data={rows}
					emptyState={empty}
					footer={
						total && (
							<TableRow>
								{selectable && <TableCell />}
								<TableCell
									colSpan={span - (selectable ? 2 : 1) - (actions ? 1 : 0)}
								>
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
								{actions && <TableCell />}
							</TableRow>
						)
					}
					hideCount
					initialSorting={sort}
					lastSelectedId={anchor}
					onClearSelection={() => setSelected(new Set())}
					onEditRow={(id) => {
						const tx = rows.find((r) => r.id === id);
						if (tx) onOpen?.(tx);
					}}
					onRangeSelect={(ids) => setSelected(new Set(ids))}
					onRowClick={onOpen}
					onRowSelect={selectable ? onToggle : undefined}
					rowClassName={(row) =>
						row.original.kind === "expense" ? undefined : "text-fg-2"
					}
					onRowOpen={onOpen}
					searchable={false}
					selectedRows={selected}
					wrapRow={rowArea}
				/>
			</SelectionContext.Provider>
		</div>
	);
}

"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { DataTable } from "~/components/data-table";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import type { TransactionVM } from "~/components/rows/types";
import { TableCell, TableRow } from "~/components/ui/table";
import { cn } from "~/lib/cn";
import { TABLE_LOOK } from "./table-style";
import { useTransactionColumns } from "./transaction-columns";

/** The footer total, computed by the server for the rows the filter shows (R9). */
export type TableTotal = {
	/** The figures registry key ("spent"). */
	figure?: string;
	count: number;
	total: MoneyValue;
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
	onOpen,
	empty,
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
	onOpen?: (tx: TransactionVM) => void;
	/** EmptyState for no rows, or no matches with Clear filters. */
	empty?: ReactNode;
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
		() => (selectable ? { selected, onToggle, onToggleAll } : undefined),
		[selectable, selected, onToggle, onToggleAll],
	);
	const columns = useTransactionColumns({
		selection,
		today,
		hideProject,
		actions,
	});
	const span = columns.length;
	return (
		<div className={cn(TABLE_LOOK, className)} data-slot="transaction-table">
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
				searchable={false}
				selectedRows={selected}
			/>
		</div>
	);
}

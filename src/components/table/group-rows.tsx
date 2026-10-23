"use client";

import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import type { TransactionVM } from "~/components/rows/types";
import { TableCell, TableRow } from "~/components/ui/table";

/**
 * Group rows inside a table (activity.html layout A, person.html months):
 * a 32px band in the page color with the group's name, and its total on
 * the money edge, so totals line up with the amounts under them (R27).
 */
export type TableGroups = {
	/** "day" leaves out the Date column (the band says it); "month" keeps it. */
	by: "day" | "month";
	label: (key: string) => string;
	/** The group's total from the server (Money with its figure), or nothing. */
	total?: (key: string) => ReactNode;
};

export const groupKey = (by: TableGroups["by"], tx: TransactionVM) =>
	by === "day" ? tx.date : tx.date.slice(0, 7);

/** The row element's data, as DataTable renders it (its memoized row). */
function rowOf(node: ReactNode): TransactionVM | null {
	if (!isValidElement(node)) return null;
	const props = node.props as { row?: { original?: TransactionVM } };
	return props.row?.original ?? null;
}

/**
 * Puts a group row before each run of rows with the same key, in the order
 * the table shows them. `span` is the number of columns before the ⋯
 * column; the band keeps an empty cell under ⋯ so its total sits on the
 * money edge.
 */
export function withGroupRows(
	children: ReactNode,
	groups: TableGroups,
	span: number,
	trail: boolean,
): ReactNode {
	const out: ReactElement[] = [];
	let last: string | null = null;
	for (const child of Children.toArray(children)) {
		const tx = rowOf(child);
		if (tx) {
			const key = groupKey(groups.by, tx);
			if (key !== last) {
				last = key;
				out.push(
					<TableRow data-group={key} key={`group-${key}`}>
						<TableCell colSpan={span}>
							<span className="text-fg-2 text-small flex items-baseline justify-between gap-4 font-medium">
								<span>{groups.label(key)}</span>
								{groups.total?.(key)}
							</span>
						</TableCell>
						{trail && <TableCell />}
					</TableRow>,
				);
			}
		}
		if (isValidElement(child)) out.push(child);
	}
	return out;
}

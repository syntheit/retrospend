"use client";

import type { ReactNode } from "react";
import { useRowDates } from "~/components/rows/dates";
import { RowList } from "~/components/rows/row";
import type { TransactionVM } from "~/components/rows/types";

/**
 * Phone expense rows grouped by day, newest first (the mockup's day groups):
 * a quiet day line over each group, so the rows need no date of their own.
 */
export function DayGroups({
	rows,
	today,
	row,
}: {
	rows: TransactionVM[];
	today: string;
	row: (tx: TransactionVM) => ReactNode;
}) {
	const { day } = useRowDates(today);
	const groups: { date: string; rows: TransactionVM[] }[] = [];
	for (const tx of rows) {
		const last = groups.at(-1);
		if (last?.date === tx.date) last.rows.push(tx);
		else groups.push({ date: tx.date, rows: [tx] });
	}
	return (
		<div className="flex flex-col gap-4">
			{groups.map((g) => (
				<section aria-label={day(g.date)} key={g.date}>
					<h3 className="text-fg-3 text-small mb-2">{day(g.date)}</h3>
					<RowList label={day(g.date)}>{g.rows.map(row)}</RowList>
				</section>
			))}
		</div>
	);
}

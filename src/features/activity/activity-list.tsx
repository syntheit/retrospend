"use client";

import { useTranslations } from "next-intl";
import { type ReactElement, type ReactNode, useCallback, useMemo } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useRowDates } from "~/components/rows/dates";
import { RowList } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { TableSkeleton } from "~/components/table/table-skeleton";
import {
	type TableTotal,
	TransactionTable,
} from "~/components/table/transaction-table";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useIsMobile } from "~/hooks/use-mobile";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";
import { toExpenseTarget, toTransactionVM } from "./to-vm";

type Props = {
	rows: ActivityRowDTO[];
	today: string;
	loading: boolean;
	total?: TableTotal;
	/** EmptyState for no rows or no matches. */
	empty: ReactNode;
	handlersFor: (row: ActivityRowDTO) => ActionHandlers<ExpenseTarget>;
	onOpen: (row: ActivityRowDTO) => void;
};

/** One row's view model, registry target and handlers, built once per row. */
function useEntries(rows: ActivityRowDTO[], props: Props) {
	const t = useTranslations("activity.row");
	return useMemo(
		() =>
			rows.map((row) => {
				const vm = toTransactionVM(row, (p) =>
					t(p.direction === "sent" ? "paidTo" : "paidYou", {
						name: p.counterparty,
					}),
				);
				return {
					row,
					vm,
					target: toExpenseTarget(row, vm.title),
					handlers: props.handlersFor(row),
				};
			}),
		[rows, props.handlersFor, t],
	);
}

type Entry = ReturnType<typeof useEntries>[number];

/** Rows in day groups, newest first (layout A on phones). */
function byDay(entries: Entry[]): [string, Entry[]][] {
	const groups: [string, Entry[]][] = [];
	for (const e of entries) {
		const last = groups[groups.length - 1];
		if (last && last[0] === e.row.date) last[1].push(e);
		else groups.push([e.row.date, [e]]);
	}
	return groups;
}

function PhoneList({ entries, props }: { entries: Entry[]; props: Props }) {
	const { day } = useRowDates(props.today);
	return (
		<div className="flex flex-col gap-4">
			{byDay(entries).map(([date, list]) => (
				<section aria-label={day(date)} data-day={date} key={date}>
					<h2 className="text-fg-2 text-small mb-2 px-1 font-medium">
						{day(date)}
					</h2>
					<RowList label={day(date)} variant="group">
						{list.map((e) => (
							<ActionArea
								entity="expense"
								handlers={e.handlers}
								key={e.row.id}
								target={e.target}
							>
								<TransactionRow
									actions={
										<ActionMenu
											entity="expense"
											handlers={e.handlers}
											target={e.target}
										/>
									}
									data-id={e.row.id}
									onOpen={
										e.row.source === "payment"
											? undefined
											: () => props.onOpen(e.row)
									}
									today={props.today}
									tx={e.vm}
								/>
							</ActionArea>
						))}
					</RowList>
				</section>
			))}
		</div>
	);
}

/**
 * The list: TransactionTable on desktop (R13), day-grouped rows on phones.
 * Every amount, share and home value is the server's; rows only format.
 */
export function ActivityList(props: Props) {
	const phone = useIsMobile();
	const entries = useEntries(props.rows, props);
	const byId = useMemo(
		() => new Map(entries.map((e) => [e.row.id, e])),
		[entries],
	);
	const actions = useCallback(
		(tx: TransactionVM) => {
			const e = byId.get(tx.id);
			return e ? (
				<ActionMenu entity="expense" handlers={e.handlers} target={e.target} />
			) : null;
		},
		[byId],
	);
	const rowArea = useCallback(
		(tx: TransactionVM, tr: ReactElement) => {
			const e = byId.get(tx.id);
			if (!e) return tr;
			return (
				<ActionArea
					entity="expense"
					handlers={e.handlers}
					key={tx.id}
					target={e.target}
				>
					{tr}
				</ActionArea>
			);
		},
		[byId],
	);
	const onOpen = useCallback(
		(tx: TransactionVM) => {
			const e = byId.get(tx.id);
			if (e && e.row.source !== "payment") props.onOpen(e.row);
		},
		[byId, props.onOpen],
	);
	if (props.loading) return <ActivitySkeleton />;
	if (phone) {
		if (!entries.length) return props.empty;
		return <PhoneList entries={entries} props={props} />;
	}
	return (
		<TransactionTable
			actions={actions}
			empty={props.empty}
			onOpen={onOpen}
			rowArea={rowArea}
			rows={entries.map((e) => e.vm)}
			selectable={false}
			today={props.today}
			total={props.total}
		/>
	);
}

/** The page's one skeleton (also the route's fallback): a table on desktop, rows on phones. */
export function ActivitySkeleton() {
	return (
		<>
			<TableSkeleton className="max-md:hidden" rows={9} />
			<SkeletonRows className="md:hidden" count={8} />
		</>
	);
}

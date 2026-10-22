"use client";

import { Receipt, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactElement, useCallback } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import { SwipeActions } from "~/components/actions/swipe-actions";
import { RowList } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { TableSkeleton } from "~/components/table/table-skeleton";
import { TransactionTable } from "~/components/table/transaction-table";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { m, PHONE_ROWS, TABLE_ROWS, TODAY } from "../fixtures/rows";
import { CAP } from "../sections";
import { Cap, Phone, Spec, States } from "../spec";
import { ACTION_IDS, useDemoHandlers } from "./demo";

const target = (tx: TransactionVM): ExpenseTarget => ({
	id: tx.id,
	name: tx.title,
	mine: tx.payerId == null || tx.payerId === "me",
	locked: false,
	reviewed: tx.reviewed,
	shared: (tx.people?.length ?? 0) > 1,
});

/** A phone row with its long press menu, ⋯ button and (iPhone) swipe. */
function PhoneTx({ tx, swipe }: { tx: TransactionVM; swipe?: boolean }) {
	const handlers = useDemoHandlers<ExpenseTarget>(ACTION_IDS.expense);
	const t = target(tx);
	return (
		<SwipeActions entity="expense" handlers={handlers} swipe={swipe} target={t}>
			<TransactionRow
				actions={
					swipe ? undefined : (
						<ActionMenu entity="expense" handlers={handlers} target={t} />
					)
				}
				tx={tx}
			/>
		</SwipeActions>
	);
}

export function TransactionsSection() {
	const g = useTranslations("gallery");
	const handlers = useDemoHandlers<ExpenseTarget>(ACTION_IDS.expense);
	const toast = useToast();
	const actions = useCallback(
		(tx: TransactionVM) => (
			<ActionMenu entity="expense" handlers={handlers} target={target(tx)} />
		),
		[handlers],
	);
	// Right-click and long press on a table row open the same registry menu.
	const rowArea = useCallback(
		(tx: TransactionVM, tr: ReactElement) => (
			<ActionArea entity="expense" handlers={handlers} target={target(tx)}>
				{tr}
			</ActionArea>
		),
		[handlers],
	);
	const onOpen = useCallback(
		(tx: TransactionVM) => toast.info(`open: ${tx.title}`),
		[toast],
	);
	return (
		<Spec id="transaction">
			<Cap>{CAP.table}</Cap>
			<TransactionTable
				actions={actions}
				onOpen={onOpen}
				rowArea={rowArea}
				rows={TABLE_ROWS}
				today={TODAY}
				total={{
					figure: "spent",
					count: TABLE_ROWS.length,
					total: m("1553000"),
					withoutRate: 1,
				}}
			/>
			<div className="mt-6 flex flex-wrap gap-6">
				<div className="w-98 max-w-full">
					<Cap>{CAP.phoneRows}</Cap>
					<Phone>
						<RowList variant="group">
							{PHONE_ROWS.map((tx) => (
								<PhoneTx key={tx.id} tx={tx} />
							))}
						</RowList>
					</Phone>
				</div>
				<div className="w-98 max-w-full">
					<Cap>{CAP.swipe}</Cap>
					<Phone>
						<RowList variant="group">
							{PHONE_ROWS.slice(0, 3).map((tx) => (
								<PhoneTx key={tx.id} swipe tx={tx} />
							))}
						</RowList>
					</Phone>
				</div>
			</div>
			<States
				className="mt-6"
				items={[
					[
						CAP.loading,
						<TableSkeleton className="w-150 max-w-full" key="t" rows={3} />,
					],
					[
						CAP.loadingRows,
						<SkeletonRows className="w-95 max-w-full" count={3} key="l" />,
					],
					[
						CAP.noMatch,
						<Empty
							action={
								<Button kind="secondary" size="sm">
									{g("clearFilters")}
								</Button>
							}
							className="w-95 max-w-full"
							hint={g("noMatchHint")}
							icon={SearchX}
							key="e"
							title={g("noMatch")}
						/>,
					],
				]}
			/>
			<Cap className="mt-6">{CAP.zero}</Cap>
			<TransactionTable
				empty={
					<Empty
						action={
							<Button kind="secondary" size="sm">
								{g("addExpense")}
							</Button>
						}
						icon={Receipt}
						title={g("noExpenses")}
					/>
				}
				rows={[]}
				total={{ figure: "spent", count: 0, total: m("0") }}
			/>
		</Spec>
	);
}

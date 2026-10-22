/**
 * Server rows to the kit's view models. Nothing is computed here (R9): the
 * amounts, the share, the home value and the sort key come from listV2;
 * this only renames fields and words a payment's title.
 */
import type { ExpenseTarget } from "~/components/actions/registry";
import type { TransactionVM } from "~/components/rows/types";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";

export type PaymentTitle = (
	p: NonNullable<ActivityRowDTO["payment"]>,
) => string;

/** Figure ids for the audit: one per row amount and share (scope = row id). */
export const rowFigure = (id: string) => `entry.amount:${id}`;
export const shareFigure = (id: string) => `entry.share:${id}`;

export function toTransactionVM(
	row: ActivityRowDTO,
	paymentTitle: PaymentTitle,
): TransactionVM {
	return {
		id: row.id,
		title: row.payment ? paymentTitle(row.payment) : row.title,
		kind: row.kind,
		category: row.category && {
			name: row.category.name ?? "",
			icon: row.category.icon,
			tone: row.category.tone,
		},
		amount: row.amount,
		...(row.home !== undefined ? { home: row.home } : {}),
		...(row.share
			? { share: row.share, shareFigure: shareFigure(row.id) }
			: {}),
		sortKey: row.sortKey,
		figure: rowFigure(row.id),
		// Reviewed is an import state; listV2 has no unreviewed rows yet (GAPS).
		reviewed: true,
		...(row.waiting ? { waiting: row.waiting } : {}),
		...(row.pending ? { pending: true } : {}),
		project: row.project,
		...(row.people ? { people: row.people } : {}),
		...(row.payerId ? { payerId: row.payerId } : {}),
		...(row.payerName ? { payerName: row.payerName } : {}),
		date: row.date,
	};
}

/** What the expense action registry needs to know about a row. */
export function toExpenseTarget(
	row: ActivityRowDTO,
	name: string,
): ExpenseTarget {
	return {
		id: row.id,
		name,
		mine: row.mine && row.canEdit,
		locked: row.locked,
		reviewed: true,
		shared: row.source === "shared",
	};
}

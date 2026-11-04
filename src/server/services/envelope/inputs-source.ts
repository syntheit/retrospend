/**
 * The Postgres implementation of the budget inputs port
 * (@retrospend/domain/envelope/inputs-port): the person's own rows, the
 * book's movement sums and Wealth moves, and the stored rates, read through
 * the caller's transaction so RLS applies and a preview sees its own
 * uncommitted rows.
 */
import type {
	BudgetInputsPort,
	OwnRows,
} from "@retrospend/domain/envelope/inputs-port";
import type { Prisma } from "~prisma";
import {
	budgetMoneyInWhere,
	budgetRefundWhere,
	budgetSpendingWhere,
} from "../spending";
import { loadRateRows } from "./rate-book";

type Tx = Prisma.TransactionClient;

const NOT_INCOME_CATEGORY = {
	NOT: { category: { is: { kind: "INCOME" as const } } },
};

const EXPENSE_SELECT = {
	id: true,
	amount: true,
	currency: true,
	amountInUSD: true,
	date: true,
	categoryId: true,
	recurringTemplateId: true,
	direction: true,
	entryKind: true,
	homeCurrency: true,
	homeAmount: true,
	budgetEnvelopeId: true,
} as const;

export function prismaBudgetInputs(
	tx: Tx,
	userId: string,
	bookId: string,
): BudgetInputsPort {
	return {
		async ownRows({ from, afterMonth }): Promise<OwnRows> {
			const moneyIn = await tx.expense.findMany({
				where: budgetMoneyInWhere(userId, from),
				select: EXPENSE_SELECT,
			});
			const spending = await tx.expense.findMany({
				where: {
					...budgetSpendingWhere(userId, { gte: from }),
					...NOT_INCOME_CATEGORY,
				},
				select: EXPENSE_SELECT,
			});
			const refunds = await tx.expense.findMany({
				where: {
					...budgetRefundWhere(userId, { gte: from }),
					...NOT_INCOME_CATEGORY,
				},
				select: EXPENSE_SELECT,
			});
			const grouped = await tx.budgetMovement.groupBy({
				by: ["month", "fromEnvelopeId", "toEnvelopeId"],
				where: { bookId, month: { gt: afterMonth } },
				_sum: { amount: true },
			});
			return {
				moneyIn,
				spending,
				refunds,
				movements: grouped.map((g) => ({
					month: g.month,
					fromEnvelopeId: g.fromEnvelopeId,
					toEnvelopeId: g.toEnvelopeId,
					amount: g._sum.amount?.toFixed() ?? "0",
				})),
			};
		},

		wealthRows() {
			return tx.wealthTransfer.findMany({
				where: { bookId },
				select: {
					id: true,
					direction: true,
					envelopeId: true,
					date: true,
					amount: true,
				},
			});
		},

		rateRows: (p) => loadRateRows(tx, p),
	};
}

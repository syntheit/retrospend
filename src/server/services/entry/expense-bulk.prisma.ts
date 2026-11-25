/**
 * The server's adapter for the bulk expense core (domain expense-write/bulk.ts):
 * the person's rows read in one query, and a category set on a group of them in
 * one. Every query is scoped to the user; the delete is the edit adapter's, so
 * a spread parent takes its parts with it.
 */
import type { ExpenseBulkPort } from "@retrospend/domain/expense-write/bulk";
import type { Prisma } from "~prisma";
import { expenseEditPort, storedExpense } from "./expense-edit.prisma";

type Tx = Prisma.TransactionClient;

export function expenseBulkPort(tx: Tx, userId: string): ExpenseBulkPort {
	const edit = expenseEditPort(tx, userId);
	return {
		remove: edit.remove,
		category: edit.category,
		rows: async (ids) => {
			const rows = await tx.expense.findMany({
				where: { id: { in: [...ids] }, userId },
				include: { _count: { select: { accountLegs: true } } },
			});
			return rows.map(({ _count, ...own }) =>
				storedExpense(own, _count.accountLegs > 0),
			);
		},
		setCategory: async (rows, categoryId, excluded) => {
			await tx.expense.updateMany({
				where: { id: { in: rows.map((r) => r.id) }, userId },
				data: {
					categoryId,
					...(excluded !== undefined && { excludeFromAnalytics: excluded }),
				},
			});
		},
	};
}

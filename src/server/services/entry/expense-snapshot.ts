/**
 * An expense and its spread parts as they are stored, for the undo of a
 * delete: every column comes back as it was (id, rate type, booked home
 * value, recurring template link, status, timestamps), so a row saved before
 * rate types existed is not looked up again at today's table. Decimals and
 * dates are tagged so JSON keeps them exact.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { packRow, type Row, unpackRow } from "./row-pack";

type Tx = Prisma.TransactionClient;

export interface ExpenseSnapshot {
	readonly userId: string;
	/** The expense first, then its spread parts. */
	readonly rows: readonly Row[];
}

const unpack = (row: Row) =>
	unpackRow(row) as unknown as Prisma.ExpenseCreateManyInput;

export async function snapshotExpense(
	tx: Tx,
	userId: string,
	id: string,
): Promise<ExpenseSnapshot> {
	const rows = await tx.expense.findMany({
		where: { userId, OR: [{ id }, { parentId: id }] },
		orderBy: { isAmortizedChild: "asc" },
	});
	return {
		userId,
		rows: rows.map((r) => packRow(r)),
	};
}

/** Puts the rows back. A category or template deleted since is dropped, not invented. */
export async function restoreExpense(
	tx: Tx,
	userId: string,
	snapshot: ExpenseSnapshot,
): Promise<string> {
	const rows = snapshot.rows.map(unpack);
	const first = rows[0];
	if (
		snapshot.userId !== userId ||
		!first ||
		rows.some((r) => r.userId !== userId)
	) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Expense not found" });
	}
	const ids = (key: "categoryId" | "recurringTemplateId") => [
		...new Set(rows.map((r) => r[key]).filter((v): v is string => !!v)),
	];
	const [cats, templates] = await Promise.all([
		tx.category.findMany({
			where: { userId, id: { in: ids("categoryId") } },
			select: { id: true },
		}),
		tx.recurringTemplate.findMany({
			where: { userId, id: { in: ids("recurringTemplateId") } },
			select: { id: true },
		}),
	]);
	const known = new Set([...cats, ...templates].map((x) => x.id));
	await tx.expense.createMany({
		data: rows.map((r) => ({
			...r,
			categoryId: r.categoryId && known.has(r.categoryId) ? r.categoryId : null,
			recurringTemplateId:
				r.recurringTemplateId && known.has(r.recurringTemplateId)
					? r.recurringTemplateId
					: null,
		})),
	});
	return first.id as string;
}

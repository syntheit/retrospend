/**
 * import.undo: takes a committed import back as one batch. Every row the
 * commit created (the ids it wrote onto the job's rows) goes through the
 * delete its kind has elsewhere: income through income.delete's path (its
 * Use my plan batch, its account legs and the month views go with it), the
 * rest like expense.delete. The job returns to Ready to review, so the same
 * file can be imported again. Rows you edited since go too: they came from
 * this import.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { forgetMonthViews } from "../envelope/month-read";
import { deleteIncomeIn } from "../income/delete.mutation";
import type { MoneyMutation } from "../preview/types";
import { IMPORT_FIGURES } from "./commit.mutation";
import { storedRows } from "./rows";

type Tx = Prisma.TransactionClient;

export interface UndoImportInput {
	readonly jobId: string;
	readonly timeZone?: string;
}

export interface UndoImportValue {
	readonly jobId: string;
	readonly removed: number;
}

const nothing = (message: string) =>
	new TRPCError({ code: "BAD_REQUEST", message });

/** Claims the imported job for this undo, so two undos never both run. */
async function claimImported(tx: Tx, userId: string, jobId: string) {
	const { count } = await tx.importJob.updateMany({
		where: { id: jobId, userId, status: "COMPLETED" },
		data: { status: "READY_FOR_REVIEW", completedAt: null },
	});
	if (count === 0) throw nothing("There is no import to undo");
}

async function deleteRows(tx: Tx, userId: string, ids: string[], tz?: string) {
	const rows = await tx.expense.findMany({
		where: { userId, id: { in: ids } },
		select: {
			id: true,
			direction: true,
			inType: true,
			_count: { select: { accountLegs: true } },
		},
	});
	const income = rows.filter(
		(r) => r.direction === "IN" && r.inType === "INCOME",
	);
	const rest = rows.filter((r) => !income.includes(r));
	if (rest.some((r) => r._count.accountLegs > 0))
		throw nothing("A row of this import moved money in an account since");
	for (const r of income)
		await deleteIncomeIn(tx, userId, { expenseId: r.id, timeZone: tz });
	const { count } = await tx.expense.deleteMany({
		where: { userId, id: { in: rest.map((r) => r.id) } },
	});
	forgetMonthViews(tx);
	return income.length + count;
}

export const undoImport: MoneyMutation<UndoImportInput, UndoImportValue> = {
	id: "import.undo",
	touches: IMPORT_FIGURES,
	run: async (tx, input, actor) => {
		const job = await tx.importJob.findFirst({
			where: { id: input.jobId, userId: actor.userId },
		});
		if (job?.status !== "COMPLETED")
			throw nothing("There is no import to undo");
		const stored = storedRows(job.transactions);
		const ids = stored.flatMap((r) => (r.expenseId ? [r.expenseId] : []));
		// The old page's import did not record its rows: nothing to take back.
		if (ids.length === 0 && (job.importedCount ?? 0) > 0)
			throw nothing("This import cannot be undone here");
		await claimImported(tx, actor.userId, job.id);
		const removed = await deleteRows(tx, actor.userId, ids, input.timeZone);
		const transactions = stored.map(({ expenseId: _id, ...rest }) => rest);
		await tx.importJob.update({
			where: { id: job.id },
			data: {
				importedCount: null,
				skippedDuplicates: null,
				transactions: transactions as unknown as Prisma.InputJsonValue,
			},
		});
		return {
			value: { jobId: job.id, removed },
			undo: {
				kind: "revert",
				mutation: "import.undo",
				rows: ids.map((id) => ({ table: "expense", id })),
			},
		};
	},
};

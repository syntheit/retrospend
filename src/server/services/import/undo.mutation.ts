/**
 * import.undo: takes a committed import back as one batch. It deletes every
 * row the commit created (the ids the commit wrote onto the job's rows) and
 * returns the job to Ready to review, so the same file can be imported
 * again. Rows you edited since are deleted too: they came from this import.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import type { MoneyMutation } from "../preview/types";
import { storedRows } from "./rows";

export interface UndoImportInput {
	readonly jobId: string;
}

export interface UndoImportValue {
	readonly jobId: string;
	readonly removed: number;
}

export const undoImport: MoneyMutation<UndoImportInput, UndoImportValue> = {
	id: "import.undo",
	touches: ["spent"],
	run: async (tx, input, actor) => {
		const job = await tx.importJob.findFirst({
			where: { id: input.jobId, userId: actor.userId },
		});
		if (!job || job.status !== "COMPLETED") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "There is no import to undo",
			});
		}
		const stored = storedRows(job.transactions);
		const ids = stored.flatMap((r) => (r.expenseId ? [r.expenseId] : []));
		// The old page's import did not record its rows: nothing to take back.
		if (ids.length === 0 && (job.importedCount ?? 0) > 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "This import cannot be undone here",
			});
		}
		const { count } = await tx.expense.deleteMany({
			where: { userId: actor.userId, id: { in: ids } },
		});
		const transactions = stored.map(({ expenseId: _id, ...rest }) => rest);
		await tx.importJob.update({
			where: { id: job.id },
			data: {
				status: "READY_FOR_REVIEW",
				completedAt: null,
				importedCount: null,
				skippedDuplicates: null,
				transactions: transactions as unknown as Prisma.InputJsonValue,
			},
		});
		return {
			value: { jobId: job.id, removed: count },
			undo: {
				kind: "revert",
				mutation: "import.undo",
				rows: ids.map((id) => ({ table: "expense", id })),
			},
		};
	},
};

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import { unconfirmRecurringIncome } from "~/server/services/income/confirm-recurring.mutation";
import { unconfirmRecurringExpense } from "~/server/services/recurring-confirm.mutation";
import {
	skipRecurring,
	unskipRecurring,
} from "~/server/services/recurring-skip.mutation";

/**
 * Skip and the Undo of a confirm or a skip, merged into the `recurring`
 * namespace in root.ts. They run the same mutations /api/v1 runs
 * (recurring-skip.mutation.ts, recurring-confirm.mutation.ts).
 */
export const recurringStepsRouter = createTRPCRouter({
	/**
	 * Takes back a confirm: the entry goes and the template returns to the due
	 * date it settled. Refused while a later confirm sits on top of it. Income
	 * has its own undo (its account leg goes back too).
	 */
	unconfirm: protectedProcedure
		.input(z.object({ expenseId: z.string().min(1), dueDate: z.date() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const done = await userTransaction(ctx.db, userId, async (tx) => {
				const row = await tx.expense.findFirst({
					where: { id: input.expenseId, userId },
					select: { direction: true },
				});
				const undo = { expenseId: input.expenseId, dueDate: input.dueDate };
				return row?.direction === "IN"
					? unconfirmRecurringIncome.run(tx, undo, { userId })
					: unconfirmRecurringExpense.run(
							tx,
							{ ...undo, timeZone: ctx.timeZone },
							{ userId },
						);
			});
			return { templateId: done.value.templateId };
		}),

	/** Skips one due item: the template moves to its next date and no entry is booked. */
	skip: protectedProcedure
		.input(z.object({ id: z.cuid(), dueDate: z.date() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const done = await userTransaction(ctx.db, userId, (tx) =>
				skipRecurring.run(
					tx,
					{
						templateId: input.id,
						dueDate: input.dueDate,
						timeZone: ctx.timeZone,
					},
					{ userId },
				),
			);
			return done.value;
		}),

	/** Puts a skipped item back on its due date, while the skip is the newest change. */
	unskip: protectedProcedure
		.input(z.object({ id: z.cuid(), dueDate: z.date() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const done = await userTransaction(ctx.db, userId, (tx) =>
				unskipRecurring.run(
					tx,
					{
						templateId: input.id,
						dueDate: input.dueDate,
						timeZone: ctx.timeZone,
					},
					{ userId },
				),
			);
			return done.value;
		}),
});

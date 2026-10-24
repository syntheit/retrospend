/**
 * Confirming a due recurring expense as a money mutation (R30): the entry
 * for the due date is booked and the template moves on, in one transaction,
 * so a preview shows exactly what Confirm writes. Recurring income has its
 * own (income/confirm-recurring.mutation.ts). The undo removes the entry and
 * puts the template back on its due date.
 */
import { nextRecurringDate } from "@retrospend/domain/recurring";
import { startOfNextDayIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import { recurringEntryData } from "./money-in.service";
import type { MoneyMutation } from "./preview/types";

export interface ConfirmRecurringExpenseInput {
	readonly templateId: string;
	/** The due date being confirmed; a repeat of the same confirm is refused. */
	readonly dueDate?: Date | null;
	/** The real amount as typed, required when the template's amount varies. */
	readonly amount?: string | null;
	readonly timeZone?: string;
}

export interface ConfirmedExpense {
	readonly expenseId: string;
	readonly templateId: string;
	readonly nextDueAt: Date;
}

const FIGURES = ["spent"];

export const confirmRecurringExpense: MoneyMutation<
	ConfirmRecurringExpenseInput,
	ConfirmedExpense
> = {
	id: "recurring.confirm",
	touches: FIGURES,
	run: async (tx, input, actor) => {
		const template = await tx.recurringTemplate.findFirst({
			where: {
				id: input.templateId,
				userId: actor.userId,
				isActive: true,
				direction: "OUT",
			},
		});
		if (!template)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Recurring template not found",
			});
		if (
			input.dueDate &&
			input.dueDate.getTime() !== template.nextDueDate.getTime()
		)
			throw new TRPCError({
				code: "CONFLICT",
				message: "This payment was already confirmed",
			});
		if (template.nextDueDate >= startOfNextDayIn(new Date(), input.timeZone))
			throw new TRPCError({
				code: "CONFLICT",
				message: "This payment is not due yet",
			});

		// Direction, amount and the due date's rate (never 1) for the row.
		const entry = await recurringEntryData(
			tx,
			template,
			input.amount ?? undefined,
		);
		const nextDueAt = nextRecurringDate(
			template.nextDueDate,
			template.frequency,
			template.anchorDay,
		);
		// The advance only succeeds while nextDueDate is still the one read,
		// so two confirms racing each other create a single expense.
		const advanced = await tx.recurringTemplate.updateMany({
			where: {
				id: template.id,
				userId: actor.userId,
				nextDueDate: template.nextDueDate,
			},
			data: {
				nextDueDate: nextDueAt,
				anchorDay: template.anchorDay ?? template.nextDueDate.getDate(),
			},
		});
		if (advanced.count === 0)
			throw new TRPCError({
				code: "CONFLICT",
				message: "This payment was already confirmed",
			});
		const row = await tx.expense.create({ data: entry, select: { id: true } });
		return {
			value: { expenseId: row.id, templateId: template.id, nextDueAt },
			undo: {
				kind: "revert",
				mutation: "recurring.unconfirm",
				rows: [
					{ table: "expense", id: row.id },
					{ table: "recurring_template", id: template.id },
				],
			},
		};
	},
};

export interface UnconfirmRecurringExpenseInput {
	readonly expenseId: string;
}

export interface UnconfirmedExpense {
	readonly expenseId: string;
	readonly templateId: string;
}

/** Removes the posted entry and puts the template back on that due date. */
export const unconfirmRecurringExpense: MoneyMutation<
	UnconfirmRecurringExpenseInput,
	UnconfirmedExpense
> = {
	id: "recurring.unconfirm",
	touches: FIGURES,
	run: async (tx, input, actor) => {
		const row = await tx.expense.findFirst({
			where: {
				id: input.expenseId,
				userId: actor.userId,
				direction: "OUT",
				recurringTemplateId: { not: null },
			},
			select: { id: true, date: true, recurringTemplateId: true },
		});
		if (!row?.recurringTemplateId)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Recurring entry not found",
			});
		await tx.expense.delete({ where: { id: row.id } });
		await tx.recurringTemplate.updateMany({
			where: {
				id: row.recurringTemplateId,
				userId: actor.userId,
				nextDueDate: { gt: row.date },
			},
			data: { nextDueDate: row.date },
		});
		return {
			value: { expenseId: row.id, templateId: row.recurringTemplateId },
			undo: {
				kind: "revert",
				mutation: "recurring.confirm",
				rows: [{ table: "recurring_template", id: row.recurringTemplateId }],
			},
		};
	},
};

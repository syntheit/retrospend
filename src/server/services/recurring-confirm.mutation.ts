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
import { paidOnInstant } from "./recurring-paid-on";

export interface ConfirmRecurringExpenseInput {
	readonly templateId: string;
	/** The due date being confirmed; a repeat of the same confirm is refused. */
	readonly dueDate?: Date | null;
	/** The real amount as typed, required when the template's amount varies. */
	readonly amount?: string | null;
	/** The day it was really paid (yyyy-MM-dd); the due date when omitted. */
	readonly paidOn?: string | null;
	readonly timeZone?: string;
}

export interface ConfirmedExpense {
	readonly expenseId: string;
	readonly templateId: string;
	readonly nextDueAt: Date;
	/** The due date this confirm settled, for the undo to put back. */
	readonly dueAt: Date;
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
				// Either direction: the web's older confirm still posts recurring
				// income through here. /api/v1 sends income to its own mutation.
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
				message: "This payment was already confirmed",
			});

		// Direction, amount and the due date's rate (never 1) for the row.
		const entry = await recurringEntryData(
			tx,
			template,
			input.amount ?? undefined,
			undefined,
			input.paidOn
				? paidOnInstant(
						input.paidOn,
						template.direction,
						input.timeZone,
						template,
					)
				: undefined,
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
			value: {
				expenseId: row.id,
				templateId: template.id,
				nextDueAt,
				dueAt: template.nextDueDate,
			},
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
	/**
	 * The due date the confirm settled. The entry may be dated another day
	 * (paid on), so the template is put back on this one; the entry's own date
	 * when omitted.
	 */
	readonly dueDate?: Date | null;
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
		const template = await tx.recurringTemplate.findFirst({
			where: { id: row.recurringTemplateId, userId: actor.userId },
			select: { nextDueDate: true, frequency: true, anchorDay: true },
		});
		// Only the newest confirm can be undone: the template must sit exactly
		// one period after this entry. Rewinding past a later confirm would
		// book those periods again.
		const dueDate = input.dueDate ?? row.date;
		if (
			template &&
			template.nextDueDate.getTime() !==
				nextRecurringDate(
					dueDate,
					template.frequency,
					template.anchorDay,
				).getTime()
		)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Undo the later confirm first",
			});
		await tx.expense.delete({ where: { id: row.id } });
		if (template)
			await tx.recurringTemplate.updateMany({
				where: {
					id: row.recurringTemplateId,
					userId: actor.userId,
					nextDueDate: template.nextDueDate,
				},
				data: { nextDueDate: dueDate },
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

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
import { dueAnchorDay, nextDueAfter } from "./income/due-day";
import { paidOnInstant } from "./recurring-paid-on";
import { userTimeZone } from "~/server/services/user-time-zone";

export interface ConfirmRecurringExpenseInput {
	readonly templateId: string;
	/** The due date being confirmed; a repeat of the same confirm is refused. */
	readonly dueDate?: Date | null;
	/** The real amount as typed, required when the template's amount varies. */
	readonly amount?: string | null;
	/** The day it was really paid (yyyy-MM-dd); the due date when omitted. */
	readonly paidOn?: string | null;
	readonly timeZone?: string;
	/**
	 * Set only by the auto-post sweep (recurring-auto-post.ts), never by a
	 * transport: the template must still pay automatically with a fixed
	 * amount, since the sweep read it before this transaction.
	 */
	readonly auto?: boolean;
}

export interface ConfirmedExpense {
	readonly expenseId: string;
	readonly templateId: string;
	readonly nextDueAt: Date;
	/** The due date this confirm settled, for the undo to put back. */
	readonly dueAt: Date;
	/** The template's anchor before this confirm (null on a legacy template), for the undo. */
	readonly anchorDay: number | null;
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
				...(input.auto && { autoPay: true, amountMode: "FIXED" }),
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
		const zone = await userTimeZone(tx, actor.userId, input.timeZone);
		if (template.nextDueDate >= startOfNextDayIn(new Date(), zone))
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
				? paidOnInstant(input.paidOn, template.direction, zone, template)
				: undefined,
		);
		// Due dates are stored as the start of a day in the user's saved zone, so
		// they step there whatever zone this request came from.
		const stepZone = await userTimeZone(tx, actor.userId);
		const nextDueAt = nextDueAfter(template, template.nextDueDate, stepZone);
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
				anchorDay: dueAnchorDay(template, stepZone),
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
				anchorDay: template.anchorDay,
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
	/**
	 * The template's anchor before the confirm, to put back (null included).
	 * Left as it is when omitted, as for a token minted before this existed.
	 */
	readonly anchorDay?: number | null;
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
		const stepZone = await userTimeZone(tx, actor.userId);
		if (
			template &&
			template.nextDueDate.getTime() !==
				nextRecurringDate(
					dueDate,
					template.frequency,
					template.anchorDay,
					stepZone,
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
				data: {
					nextDueDate: dueDate,
					...(input.anchorDay !== undefined && { anchorDay: input.anchorDay }),
				},
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

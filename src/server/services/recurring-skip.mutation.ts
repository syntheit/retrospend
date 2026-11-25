/**
 * Skipping one due recurring item as a money mutation (R30): the template
 * moves to its next date and no entry is booked, so a preview shows that
 * nothing moves but the date. The undo puts the template back on the skipped
 * date. Expense and income templates share it; only the way their due day is
 * stored differs (recurring.service dueInstant).
 */

import { dueAnchorDay, nextDueAfter } from "@retrospend/domain/recurring";
import { isDue } from "@retrospend/domain/recurring-post/due";
import {
	ITEM_ALREADY_SETTLED,
	RECURRING_NOT_FOUND,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import { TRPCError } from "@trpc/server";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { MoneyMutation } from "./preview/types";

export interface SkipRecurringInput {
	readonly templateId: string;
	/** The due date being skipped; a repeat of the same skip is refused. */
	readonly dueDate?: Date | null;
	readonly timeZone?: string;
}

export interface SkippedRecurring {
	readonly templateId: string;
	/** The due date that was skipped, for the undo to put back. */
	readonly dueAt: Date;
	readonly nextDueAt: Date;
}

export const skipRecurring: MoneyMutation<
	SkipRecurringInput,
	SkippedRecurring
> = {
	id: "recurring.skip",
	touches: [],
	run: async (tx, input, actor) => {
		const template = await tx.recurringTemplate.findFirst({
			where: { id: input.templateId, userId: actor.userId, isActive: true },
		});
		if (!template) throw new RecurringRefusal("not_found", RECURRING_NOT_FOUND);
		if (
			input.dueDate &&
			input.dueDate.getTime() !== template.nextDueDate.getTime()
		)
			throw new RecurringRefusal("already_posted", ITEM_ALREADY_SETTLED);
		// Due once its day has come: income by its UTC day, an expense by its
		// instant. This differs from confirm, which reads an income template by
		// its instant too (recurring-confirm.mutation.ts); not unified here.
		const zone = await userTimeZone(tx, actor.userId, input.timeZone);
		const rule = template.direction === "IN" ? "utc_day" : "start_of_next_day";
		if (!isDue(template.nextDueDate, new Date(), zone, rule))
			throw new RecurringRefusal("not_due", ITEM_ALREADY_SETTLED);

		// Due dates step in the user's saved zone, not this request's.
		const stepZone = await userTimeZone(tx, actor.userId);
		const nextDueAt = nextDueAfter(template, template.nextDueDate, stepZone);
		const anchorDay = dueAnchorDay(template, stepZone);
		const advanced = await tx.recurringTemplate.updateMany({
			where: {
				id: template.id,
				userId: actor.userId,
				nextDueDate: template.nextDueDate,
			},
			data: { nextDueDate: nextDueAt, anchorDay },
		});
		if (advanced.count === 0)
			throw new RecurringRefusal("already_posted", ITEM_ALREADY_SETTLED);
		return {
			value: {
				templateId: template.id,
				dueAt: template.nextDueDate,
				nextDueAt,
			},
			undo: {
				kind: "revert",
				mutation: "recurring.unskip",
				rows: [{ table: "recurring_template", id: template.id }],
			},
		};
	},
};

export interface UnskipRecurringInput {
	readonly templateId: string;
	/** The due date that was skipped. */
	readonly dueDate: Date;
}

/** Puts the template back on the skipped date, only while that skip is the newest change. */
export const unskipRecurring: MoneyMutation<
	UnskipRecurringInput,
	{ readonly templateId: string; readonly dueAt: Date }
> = {
	id: "recurring.unskip",
	touches: [],
	run: async (tx, input, actor) => {
		const template = await tx.recurringTemplate.findFirst({
			where: { id: input.templateId, userId: actor.userId },
		});
		if (!template)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Recurring template not found",
			});
		const stepZone = await userTimeZone(tx, actor.userId);
		if (
			template.nextDueDate.getTime() !==
			nextDueAfter(template, input.dueDate, stepZone).getTime()
		)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Undo the later change first",
			});
		const moved = await tx.recurringTemplate.updateMany({
			where: {
				id: template.id,
				userId: actor.userId,
				nextDueDate: template.nextDueDate,
			},
			data: { nextDueDate: input.dueDate },
		});
		if (moved.count === 0)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Undo the later change first",
			});
		return {
			value: { templateId: template.id, dueAt: input.dueDate },
			undo: {
				kind: "revert",
				mutation: "recurring.skip",
				rows: [{ table: "recurring_template", id: template.id }],
			},
		};
	},
};

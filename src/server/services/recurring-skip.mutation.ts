/**
 * Skipping one due recurring item as a money mutation (R30): the template
 * moves to its next date and no entry is booked, so a preview shows that
 * nothing moves but the date. The undo puts the template back on the skipped
 * date. Expense and income templates share it; only the way their due day is
 * stored differs (recurring.service dueInstant).
 */
import { nextRecurringDate } from "@retrospend/domain/recurring";
import { dayKey, startOfNextDayIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import { dayOf } from "./accounts/series";
import { nextDueDay } from "./income/due-day";
import type { MoneyMutation } from "./preview/types";
import { userTimeZone } from "~/server/services/user-time-zone";

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

const ALREADY = "This item was already confirmed or skipped";

interface Stepping {
	readonly direction: "OUT" | "IN";
	readonly frequency: Parameters<typeof nextRecurringDate>[1];
	readonly anchorDay: number | null;
	readonly nextDueDate: Date;
}

/** The due date after `from`, stepped the way the template stores its days. */
function after(t: Stepping, from: Date): Date {
	return t.direction === "IN"
		? nextDueDay(from, t.frequency, t.anchorDay)
		: nextRecurringDate(from, t.frequency, t.anchorDay);
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
		if (!template)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Recurring template not found",
			});
		if (
			input.dueDate &&
			input.dueDate.getTime() !== template.nextDueDate.getTime()
		)
			throw new TRPCError({ code: "CONFLICT", message: ALREADY });
		// Due once its day has come, as a confirm reads it.
		const zone = await userTimeZone(tx, actor.userId, input.timeZone);
		const due =
			template.direction === "IN"
				? dayOf(template.nextDueDate) <= dayKey(new Date(), zone)
				: template.nextDueDate < startOfNextDayIn(new Date(), zone);
		if (!due) throw new TRPCError({ code: "CONFLICT", message: ALREADY });

		const nextDueAt = after(template, template.nextDueDate);
		const anchorDay =
			template.anchorDay ??
			(template.direction === "IN"
				? template.nextDueDate.getUTCDate()
				: template.nextDueDate.getDate());
		const advanced = await tx.recurringTemplate.updateMany({
			where: {
				id: template.id,
				userId: actor.userId,
				nextDueDate: template.nextDueDate,
			},
			data: { nextDueDate: nextDueAt, anchorDay },
		});
		if (advanced.count === 0)
			throw new TRPCError({ code: "CONFLICT", message: ALREADY });
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
		if (
			template.nextDueDate.getTime() !==
			after(template, input.dueDate).getTime()
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

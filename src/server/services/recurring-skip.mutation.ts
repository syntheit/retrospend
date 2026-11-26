/**
 * Skipping one due recurring item as a money mutation (R30): the template
 * moves to its next date and no entry is booked, so a preview shows that
 * nothing moves but the date. The undo puts the template back on the skipped
 * date. Expense and income templates share it; only the way their due day is
 * stored differs (recurring-post/template dueInstant).
 */

import { nextDueAfter } from "@retrospend/domain/recurring";
import { planSkip } from "@retrospend/domain/recurring-post/plan";
import { TRPCError } from "@trpc/server";
import { userTimeZone } from "~/server/services/user-time-zone";
import { postTemplateOf } from "./money-in.service";
import type { MoneyMutation } from "./preview/types";
import { advanceTemplate } from "./recurring-advance";

export interface SkipRecurringInput {
	readonly templateId: string;
	/** The due date being skipped; a repeat of the same skip is refused. */
	readonly dueDate?: Date | null;
	readonly timeZone?: string;
	/** The template's updatedAt the caller read; a template changed since is refused as `changed`. */
	readonly expectedUpdatedAt?: Date | null;
}

export interface SkippedRecurring {
	readonly templateId: string;
	/** The template's updatedAt after this skip, for the next write's stamp. */
	readonly templateUpdatedAt: Date;
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
			where: { id: input.templateId, userId: actor.userId },
		});
		// Due once its day has come, in this request's zone. Due dates step in
		// the user's saved zone, not this request's.
		const plan = planSkip(template && postTemplateOf(template), {
			userId: actor.userId,
			now: new Date(),
			zone: await userTimeZone(tx, actor.userId, input.timeZone),
			stepZone: await userTimeZone(tx, actor.userId),
			dueAt: input.dueDate,
			expectedStamp: input.expectedUpdatedAt?.toISOString(),
		});
		await advanceTemplate(
			tx,
			actor.userId,
			plan,
			input.expectedUpdatedAt,
			"skip",
		);
		const stamp = await tx.recurringTemplate.findFirstOrThrow({
			where: { id: plan.templateId, userId: actor.userId },
			select: { updatedAt: true },
		});
		return {
			value: {
				templateId: plan.templateId,
				templateUpdatedAt: stamp.updatedAt,
				dueAt: plan.dueAt,
				nextDueAt: plan.nextDueDate,
			},
			undo: {
				kind: "revert",
				mutation: "recurring.unskip",
				rows: [{ table: "recurring_template", id: plan.templateId }],
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

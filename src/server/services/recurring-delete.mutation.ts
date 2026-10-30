/**
 * Deleting a recurring template as a mutation (R30), so the phone can preview
 * it and undo it. A template moves no figure: the entries it already logged
 * stay (they only lose their link to it). The undo puts the template back
 * with the same id and schedule; it is signed into the undo token, so a
 * client can carry it but never write its own.
 */
import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "./preview/types";
import { deleteTemplate } from "./recurring.service";

/** A template as the undo token carries it: dates as ISO text, the amount as decimal text. */
export interface TemplateSnapshot {
	readonly id: string;
	readonly name: string;
	readonly amount: string;
	readonly currency: string;
	readonly categoryId: string | null;
	readonly direction: "IN" | "OUT";
	readonly amountMode: "FIXED" | "ASK";
	readonly frequency:
		| "WEEKLY"
		| "BIWEEKLY"
		| "MONTHLY"
		| "QUARTERLY"
		| "YEARLY";
	readonly nextDueDate: string;
	readonly anchorDay: number | null;
	readonly websiteUrl: string | null;
	readonly paymentSource: string | null;
	readonly autoPay: boolean;
	readonly isActive: boolean;
}

export interface DeleteRecurringInput {
	readonly templateId: string;
}

export const deleteRecurring: MoneyMutation<
	DeleteRecurringInput,
	TemplateSnapshot
> = {
	id: "recurring.delete",
	touches: [],
	run: async (tx, input, actor) => {
		const row = await tx.recurringTemplate.findFirst({
			where: { id: input.templateId, userId: actor.userId },
		});
		if (!row)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Recurring template not found",
			});
		await deleteTemplate(tx, actor.userId, row.id);
		return {
			value: {
				id: row.id,
				name: row.name,
				amount: row.amount.toString(),
				currency: row.currency,
				categoryId: row.categoryId,
				direction: row.direction,
				amountMode: row.amountMode,
				frequency: row.frequency,
				nextDueDate: row.nextDueDate.toISOString(),
				anchorDay: row.anchorDay,
				websiteUrl: row.websiteUrl,
				paymentSource: row.paymentSource,
				autoPay: row.autoPay,
				isActive: row.isActive,
			},
			undo: {
				kind: "revert",
				mutation: "recurring.restore",
				rows: [{ table: "recurring_template", id: row.id }],
			},
		};
	},
};

export interface RestoreRecurringInput {
	readonly template: TemplateSnapshot;
}

/** Puts a deleted template back, unless one with its id exists again. */
export const restoreRecurring: MoneyMutation<
	RestoreRecurringInput,
	{ readonly id: string }
> = {
	id: "recurring.restore",
	touches: [],
	run: async (tx, input, actor) => {
		const t = input.template;
		const taken = await tx.recurringTemplate.findUnique({
			where: { id: t.id },
			select: { id: true },
		});
		if (taken)
			throw new TRPCError({
				code: "CONFLICT",
				message: "This template is back already",
			});
		// A category deleted in between leaves the template without one.
		const category = t.categoryId
			? await tx.category.findFirst({
					where: { id: t.categoryId, userId: actor.userId },
					select: { id: true },
				})
			: null;
		await tx.recurringTemplate.create({
			data: {
				id: t.id,
				userId: actor.userId,
				name: t.name,
				amount: t.amount,
				currency: t.currency,
				categoryId: category?.id ?? null,
				direction: t.direction,
				amountMode: t.amountMode,
				frequency: t.frequency,
				nextDueDate: new Date(t.nextDueDate),
				anchorDay: t.anchorDay,
				websiteUrl: t.websiteUrl,
				paymentSource: t.paymentSource,
				autoPay: t.autoPay,
				isActive: t.isActive,
			},
			select: { id: true },
		});
		return {
			value: { id: t.id },
			undo: {
				kind: "revert",
				mutation: "recurring.delete",
				rows: [{ table: "recurring_template", id: t.id }],
			},
		};
	},
};

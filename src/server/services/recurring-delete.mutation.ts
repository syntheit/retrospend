/**
 * Deleting a recurring template as a mutation (R30), so the phone can preview
 * it and undo it. It moves what recurring costs (declared), and it clears the
 * target of any BILL envelope that followed the template, which moves the
 * plan cost: a delete that finds such an envelope is the `withPlan` variant,
 * so the preview names the plan cost only when it can change. Entries the
 * template logged stay; they only lose their link to it.
 *
 * The undo puts the template back as it was: same id, schedule, auto-pay and
 * creation time, with the envelopes that followed it and the entries it
 * logged linked again. The snapshot is signed into the undo token, so a
 * client can carry it but never write its own. Anything that changed in
 * between is left alone: an envelope that follows another template now, or an
 * entry that was deleted or linked elsewhere, is not touched.
 */
import { TRPCError } from "@trpc/server";
import type { Keyring } from "~/server/crypto/field-crypto";
import type { Prisma } from "~prisma";
import { FIGURE_PLAN_COST } from "./envelope/figures";
import { RECURRING_COST_FIGURES } from "./figures/recurring";
import type { MoneyMutation } from "./preview/types";
import { deleteTemplate } from "./recurring.service";
import { pgLower, readUserText } from "./search-fold";

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
	readonly createdAt: string;
	/** BILL envelopes that followed it. */
	readonly envelopeIds: readonly string[];
	/** Entries it logged. */
	readonly expenseIds: readonly string[];
}

export interface DeleteRecurringInput {
	readonly templateId: string;
}

function deleteWith(
	touches: readonly string[],
): MoneyMutation<DeleteRecurringInput, TemplateSnapshot> {
	return {
		id: "recurring.delete",
		touches,
		run: async (tx, input, actor) => {
			const row = await tx.recurringTemplate.findFirst({
				where: { id: input.templateId, userId: actor.userId },
			});
			if (!row)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Recurring template not found",
				});
			const envelopes = await tx.envelope.findMany({
				where: { targetTemplateId: row.id },
				select: { id: true },
			});
			const expenses = await tx.expense.findMany({
				where: { recurringTemplateId: row.id, userId: actor.userId },
				select: { id: true },
			});
			// Cleared here so the order is plain; the foreign key would do it too.
			await tx.envelope.updateMany({
				where: { targetTemplateId: row.id },
				data: { targetTemplateId: null },
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
					createdAt: row.createdAt.toISOString(),
					envelopeIds: envelopes.map((e) => e.id),
					expenseIds: expenses.map((e) => e.id),
				},
				undo: {
					kind: "revert",
					mutation: "recurring.restore",
					rows: [{ table: "recurring_template", id: row.id }],
				},
			};
		},
	};
}

export const deleteRecurring = deleteWith(RECURRING_COST_FIGURES);

/** The delete of a template a BILL envelope follows: the plan cost can move too. */
export const deleteRecurringWithPlan = deleteWith([
	...RECURRING_COST_FIGURES,
	FIGURE_PLAN_COST,
]);

export interface RestoreRecurringInput {
	readonly template: TemplateSnapshot;
}

/** The name of a template row, opened: it may be ciphertext. */
const nameOf = (
	keyring: Keyring | undefined,
	row: { id: string; name: string },
) =>
	readUserText(keyring, row.name, {
		table: "recurringTemplate",
		column: "name",
		rowId: row.id,
	});

/**
 * Whether the user has an active template like `t`: the same amount,
 * currency, frequency and direction, and the same name ignoring case
 * (`lower(name) = lower(value)`, which is `pgLower` equality). SQL narrows by
 * everything but the name, so the names compared here are those of one
 * user's active templates with that exact money and schedule: a handful.
 */
async function sameByHand(
	tx: Prisma.TransactionClient,
	userId: string,
	t: TemplateSnapshot,
	keyring: Keyring | undefined,
): Promise<boolean> {
	const candidates = await tx.recurringTemplate.findMany({
		where: {
			userId,
			isActive: true,
			amount: t.amount,
			currency: t.currency,
			frequency: t.frequency,
			direction: t.direction,
		},
		select: { id: true, name: true },
	});
	const name = pgLower(nameOf(keyring, t));
	return candidates.some((c) => pgLower(nameOf(keyring, c)) === name);
}

/** Puts a deleted template back, unless one with its id, or the same one by hand, exists. */
function restoreWith(
	touches: readonly string[],
): MoneyMutation<RestoreRecurringInput, { readonly id: string }> {
	return {
		id: "recurring.restore",
		touches,
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
			// Made again by hand since: restoring would run it twice.
			const twin = t.isActive
				? await sameByHand(tx, actor.userId, t, actor.keyring)
				: false;
			if (twin)
				throw new TRPCError({
					code: "CONFLICT",
					message: "You already have a recurring expense like this one",
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
					createdAt: new Date(t.createdAt),
				},
				select: { id: true },
			});
			// Only what is still unlinked: a newer choice is not overwritten.
			if (t.envelopeIds.length > 0)
				await tx.envelope.updateMany({
					where: { id: { in: [...t.envelopeIds] }, targetTemplateId: null },
					data: { targetTemplateId: t.id },
				});
			if (t.expenseIds.length > 0)
				await tx.expense.updateMany({
					where: {
						id: { in: [...t.expenseIds] },
						userId: actor.userId,
						recurringTemplateId: null,
					},
					data: { recurringTemplateId: t.id },
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
}

export const restoreRecurring = restoreWith(RECURRING_COST_FIGURES);

/** The restore of a template that had BILL envelopes: the plan cost can move back. */
export const restoreRecurringWithPlan = restoreWith([
	...RECURRING_COST_FIGURES,
	FIGURE_PLAN_COST,
]);

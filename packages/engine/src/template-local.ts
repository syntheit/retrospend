/**
 * Recurring template create, edit (pause and resume included) and delete on
 * the device. Every rule is the domain's (recurring-post/template.ts): the
 * anchor day, the stored due instant per direction, the category kind and the
 * columns an edit writes. This file is the port: the saved zone and the
 * categories read from the store, the row written to it.
 *
 * - The zone is `SettingsRow.timeZone`, never the phone's own, so a due day
 *   typed anywhere is stored as the start of that day in the saved zone.
 * - A create takes a client-made id, so the server row meets the device row.
 *   A taken id is refused by the repo (InvalidInputError).
 * - An edit may name the version it saw (`expectedVersion`, the pulled
 *   `updatedAt`, opaque). A template that has since moved is `changed`, as the
 *   server's PATCH answers it. An edit that changes nothing writes nothing.
 * - After a write the template has no version until the server's answer names
 *   one, as after a confirm.
 * - Delete is for the compare only: the server's delete stays online (it
 *   clears BILL targets and signs its own undo), and the device runs it so the
 *   store matches the pull that follows. No outbox kind sends it.
 * - Recurring income is not on the device until M4: a create or an edit of an
 *   IN template is refused and sent directly.
 * - Text (name, websiteUrl, paymentSource) lives in the store. Anything that
 *   leaves the engine goes through `templateWithoutText` (templates.ts).
 */

import {
	templateCreateFieldsSchema,
	templateEditFieldsSchema,
} from "@retrospend/api-contract/template-fields";
import { FIGURE_PLAN_COST } from "@retrospend/domain/envelope/figures";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	RECURRING_CHANGED,
	RECURRING_NOT_FOUND,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import {
	checkTemplateCategory,
	editPatch,
	newTemplateDirection,
	newTemplateRow,
	type TemplateEdit,
	type TemplateInput,
} from "@retrospend/domain/recurring-post/template";
import { refusing } from "./expense-create";
import type { WriteFn } from "./local-db";
import { InvalidInputError } from "./port";
import { deviceMutation } from "./preview";
import { loadTemplate } from "./recurring-local";
import { DEVICE_FIGURE_IDS } from "./registry";
import type { Repos } from "./repos";
import type { TemplateRow } from "./templates";

/** An income template is made and edited online until the device books income (M4, tranche 2). */
export const INCOME_NOT_ON_DEVICE = "Recurring income is set up online";

export const TEMPLATE_CREATE = "recurring.create";
export const TEMPLATE_UPDATE = "recurring.update";
export const TEMPLATE_DELETE = "recurring.delete";

/** The cost figures a template's amount, schedule, pause or existence moves. */
const RECURRING_COST_FIGURES = DEVICE_FIGURE_IDS.filter((id) =>
	id.startsWith("recurring.cost."),
);

/** The one template's own amount figure, which an edit of its amount or currency changes. */
const RECURRING_AMOUNT_FIGURES = DEVICE_FIGURE_IDS.filter(
	(id) => id === "recurring.amount",
);

export interface CreateTemplateInput extends TemplateInput {
	/** Client-made, so the server's row can meet this one. */
	readonly id: string;
}

export interface UpdateTemplateInput extends TemplateEdit {
	readonly id: string;
	/** The template version the caller saw (its `version`); not compared when absent. */
	readonly expectedVersion?: string | null;
}

/**
 * The device sends v1, so it checks what v1 checks, with v1's own schemas
 * (api-contract template-fields.ts): the amount pattern, the currency code,
 * a real calendar day (an empty one is invalid, not absent) and the user-text
 * rules (length, control characters, lone surrogates).
 */
function checkFields(
	schema: typeof templateCreateFieldsSchema | typeof templateEditFieldsSchema,
	input: TemplateEdit,
) {
	const checked = schema.safeParse({
		name: input.name,
		amount: input.amount,
		currency: input.currency,
		nextDueDate: input.nextDueDate,
		websiteUrl: input.websiteUrl,
		paymentSource: input.paymentSource,
	});
	if (!checked.success)
		throw new InvalidInputError(checked.error.issues[0]?.message ?? "Invalid");
}

/** The amount as the store holds it: v1's plain decimal text, without trailing zeros. */
const storedAmount = (amount: string) => dec(amount).toFixed();

/** The category's kind against the template's direction, and the joined reference the store keeps. */
function categoryRefOf(
	r: Repos,
	categoryId: string | null | undefined,
	direction: TemplateRow["direction"],
): TemplateRow["category"] {
	if (!categoryId) return null;
	const found = r.categories.get(categoryId);
	checkTemplateCategory(found, direction);
	return found
		? { id: found.id, name: found.name, color: found.color, icon: found.icon }
		: null;
}

/** A new template: the domain's row, in the saved zone, under the client's id. */
export function createTemplate(
	input: CreateTemplateInput,
): WriteFn<TemplateRow> {
	return (r) =>
		refusing(() => {
			const direction = newTemplateDirection(input);
			if (direction === "IN") throw new InvalidInputError(INCOME_NOT_ON_DEVICE);
			checkFields(templateCreateFieldsSchema, input);
			const category = categoryRefOf(r, input.categoryId, direction);
			const made = newTemplateRow(
				{ ...input, amount: storedAmount(input.amount) },
				r.settings.require().timeZone,
			);
			const row: TemplateRow = {
				...made,
				id: input.id,
				categoryId: made.categoryId ?? null,
				category,
				websiteUrl: made.websiteUrl ?? null,
				paymentSource: made.paymentSource ?? null,
				isActive: true,
				version: null,
			};
			r.recurringTemplates.create(row);
			return row;
		});
}

/** An edit of the fields it names; a due date it sets is the new anchor. */
export function updateTemplate(
	input: UpdateTemplateInput,
): WriteFn<TemplateRow> {
	return (r) =>
		refusing(() => {
			const row = loadTemplate(r, input.id);
			if (row.direction === "IN")
				throw new InvalidInputError(INCOME_NOT_ON_DEVICE);
			if (input.expectedVersion && input.expectedVersion !== row.version)
				throw new RecurringRefusal("changed", RECURRING_CHANGED);
			checkFields(templateEditFieldsSchema, input);
			const category = input.categoryId
				? categoryRefOf(r, input.categoryId, row.direction)
				: null;
			const patch = editPatch(
				{
					...input,
					amount:
						input.amount === undefined ? undefined : storedAmount(input.amount),
				},
				row.direction,
				r.settings.require().timeZone,
			);
			if (Object.keys(patch).length === 0) return row;
			const next: TemplateRow = {
				...row,
				...patch,
				...(patch.categoryId !== undefined && { category }),
				version: null,
			};
			r.recurringTemplates.update(next);
			return next;
		});
}

export interface DeleteTemplateInput {
	readonly id: string;
}

/**
 * The template removed, its expenses unlinked and BILL targets cleared, as the
 * server's delete leaves them. For the compare only: nothing sends it.
 */
export function deleteTemplate(
	input: DeleteTemplateInput,
): WriteFn<TemplateRow> {
	return (r) => {
		const row = r.recurringTemplates.get(input.id);
		if (!row) throw new RecurringRefusal("not_found", RECURRING_NOT_FOUND);
		r.recurringTemplates.removeLinked(input.id);
		return row;
	};
}

/** recurring.create on the device; touches what the server's mutation does (recurring-create.mutation.ts). */
export const TEMPLATE_CREATE_MUTATION = deviceMutation({
	id: TEMPLATE_CREATE,
	touches: RECURRING_COST_FIGURES,
	write: createTemplate,
});

/** recurring.update on the device: an edit moves the cost figures and the template's own amount. */
export const TEMPLATE_UPDATE_MUTATION = deviceMutation({
	id: TEMPLATE_UPDATE,
	touches: [...RECURRING_COST_FIGURES, ...RECURRING_AMOUNT_FIGURES],
	scope: (input: UpdateTemplateInput) => ({ recurringId: input.id }),
	write: updateTemplate,
});

/** recurring.delete on the device, with the plan cost a BILL envelope follows (recurring-delete.mutation.ts). */
export const TEMPLATE_DELETE_MUTATION = deviceMutation({
	id: TEMPLATE_DELETE,
	touches: [...RECURRING_COST_FIGURES, FIGURE_PLAN_COST],
	write: deleteTemplate,
});

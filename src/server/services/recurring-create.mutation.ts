/**
 * Adding a recurring template as a mutation (R30), so the phone can preview
 * it and the write is the same code. A template moves no figure: it books
 * nothing until a confirm, so the preview shows that every total stays. The
 * undo deletes the template.
 */
import type { MoneyMutation } from "./preview/types";
import { createTemplate, type NewTemplate } from "./recurring.service";

export interface CreateRecurringInput {
	readonly template: NewTemplate;
	readonly timeZone?: string;
}

export const createRecurring: MoneyMutation<
	CreateRecurringInput,
	{ readonly id: string }
> = {
	id: "recurring.create",
	touches: [],
	run: async (tx, input, actor) => {
		const created = await createTemplate(
			tx,
			actor.userId,
			input.template,
			input.timeZone,
		);
		return {
			value: { id: created.id },
			undo: {
				kind: "revert",
				mutation: "recurring.delete",
				rows: [{ table: "recurring_template", id: created.id }],
			},
		};
	},
};

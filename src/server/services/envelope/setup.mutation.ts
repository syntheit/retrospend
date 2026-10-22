/**
 * envelope.setup as a money mutation (R30): the first-run write. Its preview
 * is the same write rolled back, so the setup sheet shows exactly what
 * starting the budget will hold. Undo deletes the book (cascade) and the
 * starting balance row.
 */
import type { SetupInput } from "~/lib/schemas/envelope";
import type { MoneyMutation } from "../preview/types";
import { setupBook } from "./book.service";
import { FIGURE_LEFT_TO_SPEND, FIGURE_NOT_PLANNED_YET } from "./verdict";

export type SetupMutationInput = SetupInput & { timeZone: string | null };

export const setupEnvelopeBook: MoneyMutation<
	SetupMutationInput,
	{ bookId: string }
> = {
	id: "envelope.setup",
	touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
	run: async (tx, { timeZone, ...input }, actor) => {
		const made = await setupBook(tx, actor.userId, input, {
			now: new Date(),
			timeZone,
		});
		return {
			value: { bookId: made.bookId },
			undo: {
				kind: "revert",
				mutation: "envelope.setup",
				rows: [
					{ table: "budget_book", id: made.bookId },
					...(made.startingBalanceExpenseId
						? [{ table: "expense", id: made.startingBalanceExpenseId }]
						: []),
				],
			},
		};
	},
};

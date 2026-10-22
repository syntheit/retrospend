/**
 * expense.create as a money mutation (R30): the same write the expense form
 * makes, so `forUser(userId).preview(createExpense, input)` shows what saving
 * would change and `apply` makes exactly that change.
 */
import { type CreateExpenseInput, createExpenseIn } from "./expense.service";
import type { MoneyMutation } from "./preview/types";

type CreatedExpense = Awaited<ReturnType<typeof createExpenseIn>>;

export const createExpense: MoneyMutation<CreateExpenseInput, CreatedExpense> =
	{
		id: "expense.create",
		touches: ["spent"],
		run: async (tx, input, actor) => {
			const expense = await createExpenseIn(tx, actor.userId, input);
			return {
				value: expense,
				// Deleting the expense removes its amortized parts too (FK cascade).
				undo: {
					kind: "revert",
					mutation: "expense.create",
					rows: [{ table: "expense", id: expense.id }],
				},
			};
		},
	};

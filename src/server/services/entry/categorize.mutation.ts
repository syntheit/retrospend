/**
 * Bulk categorize as a money mutation (R30): the preview runs the same
 * update and rolls back, and the value says where each entry was (and its
 * analytics flag), so the undo is one more call of this mutation. The rows it
 * reaches, the category rule and the category's analytics default are the
 * domain's (expense-write/bulk.ts), the same ones the device runs. A move into
 * a category held out of analytics changes spending, so it touches the figures.
 */
import {
	type Categorized as CategorizedRows,
	type CategoryMove,
	categorize,
} from "@retrospend/domain/expense-write/bulk";
import type { MoneyMutation } from "../preview/types";
import { EXPENSE_FIGURES } from "./expense.mutation";
import { expenseBulkPort } from "./expense-bulk.prisma";

export type { CategoryMove };

export interface CategorizeInput {
	readonly moves: readonly CategoryMove[];
	/** An undo: a category deleted since leaves its entries uncategorized instead of failing. */
	readonly lenient?: boolean;
}

export type Categorized = CategorizedRows;

export const categorizeExpenses: MoneyMutation<CategorizeInput, Categorized> = {
	id: "expense.categorize",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		const value = await categorize(
			expenseBulkPort(tx, actor.userId),
			input.moves,
			{ lenient: input.lenient },
		);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "expense.categorize",
				rows: value.previous
					.flatMap((move) => move.ids)
					.map((id) => ({ table: "expense", id })),
			},
		};
	},
};

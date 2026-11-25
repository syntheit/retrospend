/**
 * Bulk categorize as a money mutation (R30): the preview runs the same
 * update and rolls back, and the value says where each entry was (and its
 * analytics flag), so the undo is one more call of this mutation. The rows it
 * reaches, the category rule and the category's analytics default are the
 * domain's (expense-write/bulk.ts), the same ones the device runs. A move into
 * a category held out of analytics changes spending, so it touches the figures.
 *
 * An undo is only safe against what the move left behind, so the answer names
 * the `updatedAt` of every row it reached (`stamps`) and an undo (`lenient`)
 * must hand them back as `expected`: it runs only while every row still has
 * its stamp, compared under lock (guarded.mutation.ts) and the same in the
 * preview. One row edited since refuses the whole undo and changes nothing,
 * as a stale undo of a single expense does.
 */
import {
	type Categorized as CategorizedRows,
	type CategoryMove,
	categorize,
} from "@retrospend/domain/expense-write/bulk";
import { UNDO_NOT_VALID } from "@retrospend/domain/expense-write/refusals";
import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "../preview/types";
import { EXPENSE_FIGURES } from "./expense.mutation";
import { expenseBulkPort } from "./expense-bulk.prisma";
import { readExpenseStamps, requireExpenseStamps } from "./guarded.mutation";

export type { CategoryMove };

export interface CategorizeInput {
	readonly moves: readonly CategoryMove[];
	/** An undo: a category deleted since leaves its entries uncategorized instead of failing. */
	readonly lenient?: boolean;
	/** An undo: each row's `updatedAt` as the move left it (the answer's `stamps`). */
	readonly expected?: Readonly<Record<string, string>>;
}

export interface Categorized extends CategorizedRows {
	/** Each row reached, with the `updatedAt` it has after this write. */
	stamps: Record<string, string>;
}

const invalidUndo = () =>
	new TRPCError({ code: "BAD_REQUEST", message: UNDO_NOT_VALID });

/**
 * The stamps an undo must carry: one for every row it moves, and none for
 * any other, so a missing stamp refuses instead of passing unchecked.
 */
function expectedOf({ moves, expected }: CategorizeInput) {
	if (!expected) throw invalidUndo();
	const ids = new Set(moves.flatMap((move) => move.ids));
	const named = Object.keys(expected);
	if (named.length !== ids.size || named.some((id) => !ids.has(id)))
		throw invalidUndo();
	return new Map(Object.entries(expected));
}

export const categorizeExpenses: MoneyMutation<CategorizeInput, Categorized> = {
	id: "expense.categorize",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		if (input.lenient || input.expected)
			await requireExpenseStamps(tx, actor.userId, expectedOf(input));
		const done = await categorize(
			expenseBulkPort(tx, actor.userId),
			input.moves,
			{ lenient: input.lenient },
		);
		const reached = done.previous.flatMap((move) => move.ids);
		const stamps = await readExpenseStamps(tx, reached, actor.userId, false);
		const value: Categorized = {
			...done,
			stamps: Object.fromEntries(
				[...stamps].map(([id, at]) => [id, at.toISOString()]),
			),
		};
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "expense.categorize",
				rows: reached.map((id) => ({ table: "expense", id })),
			},
		};
	},
};

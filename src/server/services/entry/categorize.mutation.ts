/**
 * Bulk categorize as a money mutation (R30): the preview runs the same
 * update and rolls back, and the value says where each entry was, so the
 * undo is one more call of this mutation. Moving entries between categories
 * moves no money total, which the preview shows as "no change".
 */
import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "../preview/types";

/** Entries (by id) that belong in one category; null is uncategorized. */
export interface CategoryMove {
	readonly categoryId: string | null;
	readonly ids: readonly string[];
}

export interface CategorizeInput {
	readonly moves: readonly CategoryMove[];
	/** An undo: a category deleted since leaves its entries uncategorized instead of failing. */
	readonly lenient?: boolean;
}

export interface Categorized {
	readonly updated: number;
	/** Where the entries were: the input that puts them back. */
	readonly previous: readonly CategoryMove[];
}

export const categorizeExpenses: MoneyMutation<CategorizeInput, Categorized> = {
	id: "expense.categorize",
	touches: [],
	run: async (tx, input, actor) => {
		const previous = new Map<string | null, string[]>();
		let updated = 0;
		for (const move of input.moves) {
			let target = move.categoryId;
			if (target) {
				const category = await tx.category.findFirst({
					where: { id: target, userId: actor.userId, kind: "EXPENSE" },
					select: { id: true },
				});
				if (!category) {
					if (!input.lenient)
						throw new TRPCError({
							code: "FORBIDDEN",
							message: "Category not found",
						});
					target = null;
				}
			}
			const rows = await tx.expense.findMany({
				where: { id: { in: [...move.ids] }, userId: actor.userId },
				select: { id: true, categoryId: true },
			});
			for (const row of rows) {
				const ids = previous.get(row.categoryId) ?? [];
				ids.push(row.id);
				previous.set(row.categoryId, ids);
			}
			const result = await tx.expense.updateMany({
				where: { id: { in: rows.map((r) => r.id) }, userId: actor.userId },
				data: { categoryId: target },
			});
			updated += result.count;
		}
		return {
			value: {
				updated,
				previous: [...previous].map(([categoryId, ids]) => ({
					categoryId,
					ids,
				})),
			},
			undo: {
				kind: "revert",
				mutation: "expense.categorize",
				rows: [...previous.values()].flat().map((id) => ({
					table: "expense",
					id,
				})),
			},
		};
	},
};

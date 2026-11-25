/**
 * Delete and merge for the transports (tRPC categories, /api/v1/categories):
 * the one rule a bare delete adds to the mutation (a category with expenses
 * needs a choice), and the preview, apply and undo of category.merge.
 */
import { TRPCError } from "@trpc/server";
import type { db as globalDb } from "~/server/db";
import { forUser } from "../preview";
import {
	type CategoryMerged,
	type MergeInput,
	mergeCategories,
	restoreCategory,
} from "./merge.mutation";

type AppDb = typeof globalDb;

export type { CategoryMerged, MergeInput };

/**
 * What a delete asks for: a category that still has expenses is deleted only
 * with a replacement or with `reassignToUncategorized`, else CONFLICT. An
 * empty category goes as it is.
 */
export async function deleteRequest(
	db: AppDb,
	userId: string,
	id: string,
	options: {
		replacementCategoryId?: string;
		reassignToUncategorized?: boolean;
	},
): Promise<MergeInput> {
	const found = await db.category.findFirst({
		where: { id, userId },
		select: { id: true },
	});
	if (!found)
		throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
	const { replacementCategoryId, reassignToUncategorized } = options;
	if (replacementCategoryId) return { id, targetId: replacementCategoryId };
	const expenses = await db.expense.count({
		where: { categoryId: id, userId },
	});
	if (expenses > 0 && !reassignToUncategorized)
		throw new TRPCError({
			code: "CONFLICT",
			message: `This category has ${expenses} expense(s). Please choose a replacement category or select "Uncategorized".`,
		});
	return { id, targetId: null };
}

export const previewRemove = (userId: string, input: MergeInput) =>
	forUser(userId).preview(mergeCategories, input);

export const applyRemove = (userId: string, input: MergeInput) =>
	forUser(userId).apply(mergeCategories, input);

export const previewRestore = (userId: string, stash: string) =>
	forUser(userId).preview(restoreCategory, { stash });

export const applyRestore = (userId: string, stash: string) =>
	forUser(userId).apply(restoreCategory, { stash });

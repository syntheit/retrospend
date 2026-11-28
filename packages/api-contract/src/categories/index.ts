import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { undoTokenSchema } from "../common/preview";
import { idParamsSchema, idSchema, okSchema } from "../core";
import { previewTwin, undoField, undoInputSchema } from "../ledger";
import {
	CATEGORY_COLORS,
	categoryColorSchema,
	categoryExpectedVersionSchema,
	categoryNameSchema,
	categoryVersionSchema,
	createCategorySchema,
	patchCategorySchema,
	updateCategorySchema,
} from "./schemas";

export {
	CATEGORY_COLORS,
	categoryColorSchema,
	categoryExpectedVersionSchema,
	categoryNameSchema,
	categoryVersionSchema,
	createCategorySchema,
	patchCategorySchema,
	updateCategorySchema,
};

export const categorySchema = z
	.object({
		id: idSchema,
		name: z.string(),
		color: categoryColorSchema,
		icon: z.string().nullable(),
		/** Whether it files expenses or income. */
		kind: z.enum(["expense", "income"]),
		/** The category-n design token number the color maps to (1 to 21). */
		tone: z.int(),
		excludeByDefault: z.boolean(),
		/** Expenses filed under it (amortized parts count one each). */
		expenseCount: z.int().min(0),
		version: categoryVersionSchema,
	})
	.meta({ id: "Category" });

export type CategoryDto = z.infer<typeof categorySchema>;

export const deleteCategorySchema = z
	.object({
		/**
		 * A category that still has expenses is only deleted with this set:
		 * its expenses and recurring templates become uncategorized and its
		 * budgets are removed. To keep them, merge it instead.
		 */
		uncategorize: z.boolean().optional(),
	})
	.meta({ id: "DeleteCategory" });

/** The category as it is after a create or an edit, with the token that takes the write back. */
export const categoryWrittenSchema = categorySchema
	.extend(undoField)
	.meta({ id: "CategoryWritten" });

export const categoryDeleteResultSchema = okSchema
	.extend(undoField)
	.meta({ id: "CategoryDeleteResult" });

/** The target as it is after the merge, with the token that takes the merge back. */
export const categoryMergedSchema = categorySchema
	.extend(undoField)
	.meta({ id: "CategoryMerged" });

export const categoryUndoResultSchema = z
	.object({
		/** The category that is back, or that goes again on a redo. */
		id: idSchema,
		/** Puts the undo back (redo). */
		redo: undoTokenSchema,
	})
	.meta({ id: "CategoryUndo" });

const TAG = ["Categories"];

export const categoriesContract = {
	list: v1
		.route({
			method: "GET",
			path: "/categories",
			operationId: "listCategories",
			tags: TAG,
			summary: "The caller's categories, by name",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(categorySchema)),
	get: v1
		.route({
			method: "GET",
			path: "/categories/{id}",
			operationId: "getCategory",
			tags: TAG,
			summary: "One category",
		})
		.meta({ scope: "read" })
		.input(idParamsSchema)
		.output(categorySchema),
	create: v1
		.route({
			method: "POST",
			path: "/categories",
			operationId: "createCategory",
			tags: TAG,
			summary: "Add a category",
			description:
				"A name the caller already uses is a conflict (names are compared after trimming spaces at both ends, and case counts: Food and food are two). A client id already in use is 409 id_taken. The answer carries version 0 and an undo token that takes the category back while nothing is filed under it.",
			successStatus: 201,
		})
		.meta({ scope: "write:expenses", event: "category.created" })
		.input(createCategorySchema)
		.output(categoryWrittenSchema),
	previewCreate: previewTwin({
		path: "/categories",
		of: "POST /categories",
		operationId: "previewCreateCategory",
		tags: TAG,
		scope: "write:expenses",
		input: createCategorySchema,
	}),
	update: v1
		.route({
			method: "PATCH",
			path: "/categories/{id}",
			operationId: "updateCategory",
			tags: TAG,
			summary: "Rename, recolor or change a category",
			description:
				"Name only the fields that change: a `name` sent is a rename and moves the version, even when it equals the stored one. At least one field is required, and `kind` is refused. With `expectedVersion`, the write lands only while the category still has that version (409 category_changed otherwise). The answer carries the new version and an undo token that puts the replaced fields back while the version is still the one this write left.",
		})
		.meta({ scope: "write:expenses", event: "category.updated" })
		.input(patchCategorySchema)
		.output(categoryWrittenSchema),
	previewUpdate: previewTwin({
		path: "/categories/{id}",
		of: "PATCH /categories/{id}",
		operationId: "previewUpdateCategory",
		tags: TAG,
		scope: "write:expenses",
		input: patchCategorySchema,
	}),
	delete: v1
		.route({
			method: "DELETE",
			path: "/categories/{id}",
			operationId: "deleteCategory",
			tags: TAG,
			summary: "Delete a category",
			description:
				'Refused with conflict while it has expenses, unless uncategorize is true. Refused with `category_closed_month` when a closed budget month would file its rows in another envelope, and with `category_income_rule` while an income rule uses it. The undo token brings the category and everything it held back, once, for 24 hours. The preview\'s detail is `{ kind: "category.merge", mode, counts, rerouted, setToNone }`.',
		})
		.meta({ scope: "write:expenses", event: "category.deleted" })
		.input(idParamsSchema.extend(deleteCategorySchema.shape))
		.output(categoryDeleteResultSchema),
	previewDelete: previewTwin({
		path: "/categories/{id}",
		twinPath: "/categories/{id}/delete/preview",
		of: "DELETE /categories/{id}",
		operationId: "previewDeleteCategory",
		tags: TAG,
		scope: "write:expenses",
		input: idParamsSchema.extend(deleteCategorySchema.shape),
	}),
	merge: v1
		.route({
			method: "POST",
			path: "/categories/{id}/merge",
			operationId: "mergeCategory",
			tags: TAG,
			summary: "Move everything in this category into another, then delete it",
			description:
				"Expenses (income, fees and spread parts too), recurring templates, shared expenses, your shares, budgets, envelope links, the analytics preference, income rules and drafts move to the target; the analytics flag of each expense stays as it is. Where both have a budget for the same month, the target's is kept; where both are in an envelope of one book, the target's envelope wins. An expense category and an income category are refused with `category_kind_mismatch`, a closed month that would route them differently with `category_closed_month`, and an income rule you cannot change with `category_income_rule`. The undo token brings everything back, once, for 24 hours.",
		})
		.meta({ scope: "write:expenses", event: "category.merged" })
		.input(idParamsSchema.extend({ targetId: idSchema }))
		.output(categoryMergedSchema),
	previewMerge: previewTwin({
		path: "/categories/{id}/merge",
		of: "POST /categories/{id}/merge",
		operationId: "previewMergeCategory",
		tags: TAG,
		scope: "write:expenses",
		input: idParamsSchema.extend({ targetId: idSchema }),
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/categories/undo",
			operationId: "undoCategoryWrite",
			tags: TAG,
			summary: "Take back a category write from its undo token",
			description:
				"Takes back a delete, a merge, a create or an edit. A delete or merge: the category comes back under its own id with its rows, budgets, envelope links, rules and drafts; refused with a conflict, changing nothing, when any of them changed since, when the target is gone, or when the name was taken again; a shared expense you cannot edit that went to no category is not brought back. A create: the category is deleted, and refused with a conflict, changing nothing, when anything is filed under it or uses it (an expense, a draft, a budget, a share, anyone's). An edit: the replaced fields are put back as a write, and refused with 409 category_changed when the category has another version than the edit left.",
		})
		.meta({ scope: "write:expenses", event: "category.undone" })
		.input(undoInputSchema)
		.output(categoryUndoResultSchema),
	previewUndo: previewTwin({
		path: "/categories/undo",
		of: "POST /categories/undo",
		operationId: "previewUndoCategoryWrite",
		tags: TAG,
		scope: "write:expenses",
		input: undoInputSchema,
	}),
};

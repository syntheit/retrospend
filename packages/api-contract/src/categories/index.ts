import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { idParamsSchema, idSchema, okSchema } from "../core";

/** Mirrors CATEGORY_COLORS in src/lib/constants.ts (a server test keeps them equal). */
export const CATEGORY_COLORS = [
	"emerald",
	"blue",
	"sky",
	"cyan",
	"teal",
	"orange",
	"amber",
	"violet",
	"pink",
	"fuchsia",
	"indigo",
	"slate",
	"zinc",
	"lime",
	"neutral",
	"gray",
	"purple",
	"yellow",
	"stone",
	"rose",
	"red",
] as const;

export const categoryColorSchema = z
	.enum(CATEGORY_COLORS)
	.meta({ id: "CategoryColor" });

export const categorySchema = z
	.object({
		id: idSchema,
		name: z.string(),
		color: categoryColorSchema,
		icon: z.string().nullable(),
		excludeByDefault: z.boolean(),
		/** Expenses filed under it (amortized parts count one each). */
		expenseCount: z.int().min(0),
	})
	.meta({ id: "Category" });

export type CategoryDto = z.infer<typeof categorySchema>;

const nameSchema = z.string().trim().min(1).max(64);
const iconSchema = z.string().max(50);

export const createCategorySchema = z
	.object({
		name: nameSchema,
		color: categoryColorSchema,
		icon: iconSchema.optional(),
		excludeByDefault: z.boolean().optional(),
	})
	.meta({ id: "CreateCategory" });

export const updateCategorySchema = z
	.object({
		name: nameSchema,
		color: categoryColorSchema,
		/** Null removes the icon. */
		icon: iconSchema.nullable(),
		excludeByDefault: z.boolean(),
	})
	.partial()
	.meta({ id: "UpdateCategory" });

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
			description: "A name the caller already uses is a conflict.",
			successStatus: 201,
		})
		.meta({ scope: "write:expenses", event: "category.created" })
		.input(createCategorySchema)
		.output(categorySchema),
	update: v1
		.route({
			method: "PATCH",
			path: "/categories/{id}",
			operationId: "updateCategory",
			tags: TAG,
			summary: "Rename, recolor or change a category",
		})
		.meta({ scope: "write:expenses", event: "category.updated" })
		.input(idParamsSchema.extend(updateCategorySchema.shape))
		.output(categorySchema),
	delete: v1
		.route({
			method: "DELETE",
			path: "/categories/{id}",
			operationId: "deleteCategory",
			tags: TAG,
			summary: "Delete a category",
			description:
				"Refused with conflict while it has expenses, unless uncategorize is true.",
		})
		.meta({ scope: "write:expenses", event: "category.deleted" })
		.input(idParamsSchema.extend(deleteCategorySchema.shape))
		.output(okSchema),
	merge: v1
		.route({
			method: "POST",
			path: "/categories/{id}/merge",
			operationId: "mergeCategory",
			tags: TAG,
			summary: "Move everything in this category into another, then delete it",
			description:
				"Expenses, recurring templates, shared expenses and budgets move to the target. Where both have a budget for the same month, the target's is kept.",
		})
		.meta({ scope: "write:expenses", event: "category.merged" })
		.input(idParamsSchema.extend({ targetId: idSchema }))
		.output(categorySchema),
};

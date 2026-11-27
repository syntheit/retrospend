import { categoryNameSchema } from "@retrospend/api-contract";
import { z } from "zod";
import { CATEGORY_COLORS } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	applyRemove,
	applyRestore,
	deleteRequest,
	previewRemove,
} from "~/server/services/category/remove";
import {
	createCategory,
	listCategoriesByUsage,
	updateCategory,
} from "~/server/services/category.service";
import { categoryIdSchema } from "~/lib/schemas/row-ids";

const createFields = {
	name: categoryNameSchema,
	color: z.enum(CATEGORY_COLORS, {
		message: "Category color is invalid",
	}),
	icon: z.string().max(50).optional(),
	excludeByDefault: z.boolean().optional(),
};

/**
 * An edit names only what changes. `name` is optional so a save that renames
 * nothing leaves it out and does not move the category's version (the server
 * never compares names; a sent name is a rename).
 */
const categoryFields = {
	...createFields,
	name: createFields.name.optional(),
	color: createFields.color.optional(),
};

/** Without the expense count, as these mutations always answered. */
function withoutCount<T extends { _count: unknown }>(row: T) {
	const { _count, ...rest } = row;
	return rest;
}

const removeSchema = z.object({
	id: categoryIdSchema,
	/** The category the rows move to; null deletes and leaves them uncategorized. */
	targetId: categoryIdSchema.nullable(),
});

export const categoriesRouter = createTRPCRouter({
	getAll: protectedProcedure.query(({ ctx }) =>
		listCategoriesByUsage(ctx.db, ctx.session.user.id),
	),

	create: protectedProcedure
		.input(z.object(createFields))
		.mutation(async ({ ctx, input }) =>
			withoutCount(await createCategory(ctx.db, ctx.session.user.id, input)),
		),

	update: protectedProcedure
		.input(z.object({ id: categoryIdSchema, ...categoryFields }))
		.mutation(async ({ ctx, input }) => {
			const { id, ...changes } = input;
			return withoutCount(
				await updateCategory(ctx.db, ctx.session.user.id, id, changes),
			);
		}),

	/** Delete or merge, as the web's sheet shows it: what changes and what does not. */
	previewRemove: protectedProcedure
		.input(removeSchema)
		.query(({ ctx, input }) => previewRemove(ctx.session.user.id, input)),

	/**
	 * Delete or merge; its undo is `restore` with the answer's stash.
	 * `refuseIfUsed` is the old delete's rule (a category with expenses needs a
	 * choice, else CONFLICT), for an undo of a category the flow itself made.
	 */
	remove: protectedProcedure
		.input(removeSchema.extend({ refuseIfUsed: z.boolean().optional() }))
		.mutation(async ({ ctx, input }) => {
			const { refuseIfUsed, ...request } = input;
			const userId = ctx.session.user.id;
			return applyRemove(
				userId,
				refuseIfUsed
					? await deleteRequest(ctx.db, userId, request.id, {
							replacementCategoryId: request.targetId ?? undefined,
						})
					: request,
			);
		}),

	restore: protectedProcedure
		.input(z.object({ stash: z.uuid() }))
		.mutation(({ ctx, input }) =>
			applyRestore(ctx.session.user.id, input.stash),
		),
});

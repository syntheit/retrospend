import { z } from "zod";
import { CATEGORY_COLORS } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	createCategory,
	deleteCategory,
	listCategoriesByUsage,
	updateCategory,
} from "~/server/services/category.service";

const categoryFields = {
	name: z.string().min(1, "Category name is required").max(64),
	color: z.enum(CATEGORY_COLORS, {
		message: "Category color is invalid",
	}),
	icon: z.string().max(50).optional(),
	excludeByDefault: z.boolean().optional(),
};

/** Without the expense count, as these mutations always answered. */
function withoutCount<T extends { _count: unknown }>(row: T) {
	const { _count, ...rest } = row;
	return rest;
}

export const categoriesRouter = createTRPCRouter({
	getAll: protectedProcedure.query(({ ctx }) =>
		listCategoriesByUsage(ctx.db, ctx.session.user.id),
	),

	create: protectedProcedure
		.input(z.object(categoryFields))
		.mutation(async ({ ctx, input }) =>
			withoutCount(await createCategory(ctx.db, ctx.session.user.id, input)),
		),

	update: protectedProcedure
		.input(z.object({ id: z.cuid(), ...categoryFields }))
		.mutation(async ({ ctx, input }) => {
			const { id, ...changes } = input;
			return withoutCount(
				await updateCategory(ctx.db, ctx.session.user.id, id, changes),
			);
		}),

	delete: protectedProcedure
		.input(
			z.object({
				id: z.cuid(),
				replacementCategoryId: z.cuid().optional(),
				reassignToUncategorized: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { id, ...options } = input;
			await deleteCategory(ctx.db, ctx.session.user.id, id, options);
			return { success: true };
		}),
});

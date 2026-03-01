import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CATEGORY_COLORS } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const categoriesRouter = createTRPCRouter({
	getAll: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		return await db.category.findMany({
			where: {
				userId: session.user.id,
			},
			orderBy: [
				{
					expenses: {
						_count: "desc",
					},
				},
				{
					name: "asc",
				},
			],
			select: {
				id: true,
				name: true,
				color: true,
				icon: true,
				_count: {
					select: {
						expenses: true,
					},
				},
			},
		});
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1, "Category name is required"),
				color: z.enum(CATEGORY_COLORS, {
					message: "Category color is invalid",
				}),
				icon: z.string().max(50).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const existingCategory = await db.category.findUnique({
				where: {
					name_userId: {
						name: input.name,
						userId: session.user.id,
					},
				},
			});

			if (existingCategory) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Category name already exists",
				});
			}

			return await db.category.create({
				data: {
					name: input.name,
					color: input.color,
					icon: input.icon,
					userId: session.user.id,
				},
				select: {
					id: true,
					name: true,
					color: true,
					icon: true,
				},
			});
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
				name: z.string().min(1, "Category name is required"),
				color: z.enum(CATEGORY_COLORS, {
					message: "Category color is invalid",
				}),
				icon: z.string().max(50).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const existingCategory = await db.category.findFirst({
				where: {
					name: input.name,
					userId: session.user.id,
					id: { not: input.id },
				},
			});

			if (existingCategory) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Category name already exists",
				});
			}

			return await db.category.update({
				where: {
					id: input.id,
					userId: session.user.id,
				},
				data: {
					name: input.name,
					color: input.color,
					icon: input.icon,
				},
				select: {
					id: true,
					name: true,
					color: true,
					icon: true,
				},
			});
		}),

	delete: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const expensesCount = await db.expense.count({
				where: {
					categoryId: input.id,
					userId: session.user.id,
				},
			});

			if (expensesCount > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot delete category that has expenses",
				});
			}

			await db.category.delete({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			return { success: true };
		}),
});

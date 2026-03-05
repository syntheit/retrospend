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
				name: z.string().min(1, "Category name is required").max(64),
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
				name: z.string().min(1, "Category name is required").max(64),
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
				replacementCategoryId: z.string().cuid().optional(),
				reassignToUncategorized: z.boolean().optional(),
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

			if (
				expensesCount > 0 &&
				!input.replacementCategoryId &&
				!input.reassignToUncategorized
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `This category has ${expensesCount} expense(s). Please choose a replacement category or select "Uncategorized".`,
				});
			}

			if (expensesCount > 0) {
				if (input.replacementCategoryId) {
					// Validate replacement belongs to user
					const replacement = await db.category.findFirst({
						where: {
							id: input.replacementCategoryId,
							userId: session.user.id,
						},
					});

					if (!replacement) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Replacement category not found",
						});
					}
				}

				const newCategoryId = input.replacementCategoryId ?? null;

				// Reassign in a transaction
				await db.$transaction(async (tx) => {
					await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
					                            set_config('role', 'retrospend_app', true)`;
					await tx.expense.updateMany({
						where: { categoryId: input.id, userId: session.user.id },
						data: { categoryId: newCategoryId },
					});

					// Budgets have a unique(userId, categoryId, period) constraint.
					// If the replacement category already has a budget for the same period,
					// we must delete the conflicting old budget rather than move it.
					if (newCategoryId) {
						const conflictingBudgets = await tx.budget.findMany({
							where: { categoryId: newCategoryId, userId: session.user.id },
							select: { period: true },
						});
						const conflictPeriods = conflictingBudgets.map((b) => b.period);
						if (conflictPeriods.length > 0) {
							await tx.budget.deleteMany({
								where: {
									categoryId: input.id,
									userId: session.user.id,
									period: { in: conflictPeriods },
								},
							});
						}
					}
					await tx.budget.updateMany({
						where: { categoryId: input.id, userId: session.user.id },
						data: { categoryId: newCategoryId },
					});

					await tx.recurringTemplate.updateMany({
						where: { categoryId: input.id, userId: session.user.id },
						data: { categoryId: newCategoryId },
					});
					await tx.category.delete({
						where: { id: input.id, userId: session.user.id },
					});
				});
			} else {
				// No expenses — delete directly
				await db.category.delete({
					where: {
						id: input.id,
						userId: session.user.id,
					},
				});
			}

			return { success: true };
		}),
});

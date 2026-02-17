import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generateCsv } from "~/lib/csv";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import * as BudgetService from "~/server/services/budget.service";

export const budgetRouter = createTRPCRouter({
	hasBudgetsBeforeMonth: protectedProcedure
		.input(
			z.object({
				month: z.date(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const targetPeriod = new Date(
				input.month.getFullYear(),
				input.month.getMonth(),
				1,
			);

			// Check if there are any budgets BEFORE this month
			const count = await db.budget.count({
				where: {
					userId: session.user.id,
					period: {
						lt: targetPeriod,
					},
				},
			});

			return count > 0;
		}),

	getEarliestBudgetMonth: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const earliestBudget = await db.budget.findFirst({
			where: {
				userId: session.user.id,
			},
			orderBy: {
				period: "asc",
			},
			select: {
				period: true,
			},
		});

		return earliestBudget?.period ?? null;
	}),

	getBudgets: protectedProcedure
		.input(
			z.object({
				month: z.date().optional(), // Defaults to current month
			}),
		)
		.query(async ({ ctx, input }) => {
			const month = input.month ?? new Date();
			return BudgetService.getBudgets(ctx.db, ctx.session.user.id, month);
		}),

	upsertBudget: protectedProcedure
		.input(
			z.object({
				categoryId: z.string().cuid(),
				amount: z.number().min(0, "Budget amount must be non-negative"),
				currency: z.string().length(3, "Currency must be a 3-letter code"),
				period: z.date(),
				isRollover: z.boolean().optional().default(false),
				pegToActual: z.boolean().optional().default(false),
				type: z
					.enum(["FIXED", "PEG_TO_ACTUAL", "PEG_TO_LAST_MONTH"])
					.optional()
					.default("FIXED"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const category = await db.category.findFirst({
				where: {
					id: input.categoryId,
					userId: session.user.id,
				},
			});

			if (!category) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Category not found",
				});
			}

			const normalizedPeriod = new Date(
				input.period.getFullYear(),
				input.period.getMonth(),
				1,
			);

			// Logic to align pegToActual boolean with type enum if not explicitly provided or if conflicting
			// If pegToActual is true and type is FIXED, set type to PEG_TO_ACTUAL (legacy support)
			let budgetType = input.type;
			if (input.pegToActual && input.type === "FIXED") {
				budgetType = "PEG_TO_ACTUAL";
			}

			const budget = await db.budget.upsert({
				where: {
					userId_categoryId_period: {
						userId: session.user.id,
						categoryId: input.categoryId,
						period: normalizedPeriod,
					},
				},
				update: {
					amount: input.amount,
					currency: input.currency,
					isRollover: input.isRollover,
					pegToActual: input.pegToActual,
					type: budgetType,
				},
				create: {
					userId: session.user.id,
					categoryId: input.categoryId,
					amount: input.amount,
					currency: input.currency,
					period: normalizedPeriod,
					isRollover: input.isRollover,
					pegToActual: input.pegToActual,
					type: budgetType,
				},
				include: {
					category: {
						select: {
							id: true,
							name: true,
							color: true,
							icon: true,
						},
					},
				},
			});

			return {
				...budget,
				amount:
					typeof budget.amount === "object" &&
					budget.amount !== null &&
					"toNumber" in budget.amount
						? budget.amount.toNumber()
						: Number(budget.amount),
			};
		}),

	batchUpsertBudgets: protectedProcedure
		.input(
			z.array(
				z.object({
					categoryId: z.string().cuid(),
					amount: z.number().min(0, "Budget amount must be non-negative"),
					currency: z.string().length(3, "Currency must be a 3-letter code"),
					period: z.date(),
					isRollover: z.boolean().optional().default(false),
					pegToActual: z.boolean().optional().default(false),
					type: z
						.enum(["FIXED", "PEG_TO_ACTUAL", "PEG_TO_LAST_MONTH"])
						.optional()
						.default("FIXED"),
				}),
			),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const results = await db.$transaction(async (tx) => {
				const processed = [];

				for (const item of input) {
					const normalizedPeriod = new Date(
						item.period.getFullYear(),
						item.period.getMonth(),
						1,
					);

					let budgetType = item.type;
					if (item.pegToActual && item.type === "FIXED") {
						budgetType = "PEG_TO_ACTUAL";
					}

					const budget = await tx.budget.upsert({
						where: {
							userId_categoryId_period: {
								userId: session.user.id,
								categoryId: item.categoryId,
								period: normalizedPeriod,
							},
						},
						update: {
							amount: item.amount,
							currency: item.currency,
							isRollover: item.isRollover,
							pegToActual: item.pegToActual,
							type: budgetType,
						},
						create: {
							userId: session.user.id,
							categoryId: item.categoryId,
							amount: item.amount,
							currency: item.currency,
							period: normalizedPeriod,
							isRollover: item.isRollover,
							pegToActual: item.pegToActual,
							type: budgetType,
						},
					});
					processed.push(budget);
				}
				return processed;
			});

			return { count: results.length };
		}),

	getBudgetSuggestions: protectedProcedure
		.input(
			z.object({
				categoryId: z.string().cuid(),
				currency: z.string().length(3).optional().default("USD"),
			}),
		)
		.query(async ({ ctx, input }) => {
			return BudgetService.getSuggestions(
				ctx.db,
				ctx.session.user.id,
				input.categoryId,
				input.currency,
			);
		}),

	getGlobalBudget: protectedProcedure
		.input(
			z.object({
				month: z.date().optional(), // Defaults to current month
			}),
		)
		.query(async ({ ctx, input }) => {
			const month = input.month ?? new Date();
			return BudgetService.getGlobalBudget(ctx.db, ctx.session.user.id, month);
		}),

	upsertGlobalBudget: protectedProcedure
		.input(
			z.object({
				amount: z.number().positive("Global budget amount must be positive"),
				currency: z.string().length(3, "Currency must be a 3-letter code"),
				period: z.date(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const normalizedPeriod = new Date(
				input.period.getFullYear(),
				input.period.getMonth(),
				1,
			);

			const existingBudget = await db.budget.findFirst({
				where: {
					userId: session.user.id,
					categoryId: null,
					period: normalizedPeriod,
				},
			});

			const budget = existingBudget
				? await db.budget.update({
						where: { id: existingBudget.id },
						data: { amount: input.amount, currency: input.currency },
					})
				: await db.budget.create({
						data: {
							userId: session.user.id,
							categoryId: null,
							amount: input.amount,
							currency: input.currency,
							period: normalizedPeriod,
						},
					});

			return {
				...budget,
				amount:
					typeof budget.amount === "object" &&
					budget.amount !== null &&
					"toNumber" in budget.amount
						? budget.amount.toNumber()
						: Number(budget.amount),
			};
		}),

	deleteBudget: protectedProcedure
		.input(
			z.object({
				budgetId: z.string().cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const budget = await db.budget.findFirst({
				where: {
					id: input.budgetId,
					userId: session.user.id,
				},
			});

			if (!budget) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Budget not found",
				});
			}

			await db.budget.delete({
				where: {
					id: input.budgetId,
				},
			});

			return { success: true };
		}),

	deleteGlobalBudget: protectedProcedure
		.input(
			z.object({
				period: z.date(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;
			const normalizedPeriod = new Date(
				input.period.getFullYear(),
				input.period.getMonth(),
				1,
			);

			await db.budget.deleteMany({
				where: {
					userId: session.user.id,
					categoryId: null,
					period: normalizedPeriod,
				},
			});

			return { success: true };
		}),

	copyFromLastMonth: protectedProcedure
		.input(
			z.object({
				targetMonth: z.date(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return BudgetService.copyFromLastMonth(
				ctx.db,
				ctx.session.user.id,
				input.targetMonth,
			);
		}),

	exportCsv: protectedProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		const budgets = await db.budget.findMany({
			where: { userId: session.user.id },
			orderBy: [{ period: "desc" }, { categoryId: "asc" }],
			include: { category: { select: { name: true } } },
		});

		const headers = [
			"categoryName",
			"amount",
			"period",
			"isRollover",
			"rolloverAmount",
			"pegToActual",
		];

		const rows = budgets.map((budget) => [
			budget.category?.name ?? "",
			BudgetService.toNumber(budget.amount),
			budget.period,
			budget.isRollover,
			BudgetService.toNumber(budget.rolloverAmount),
			budget.pegToActual,
		]);

		const csv = generateCsv(headers, rows);
		return { csv };
	}),

	importBudgets: protectedProcedure
		.input(
			z.object({
				rows: z
					.array(
						z.object({
							categoryName: z.string().optional(),
							amount: z.number().nonnegative(),
							period: z.date(),
							isRollover: z.boolean().optional().default(false),
							rolloverAmount: z.number().optional().default(0),
							pegToActual: z.boolean().optional().default(false),
						}),
					)
					.min(1, "At least one row is required"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const { rows } = input;

			// 1. Fetch all user categories to map names to IDs
			const categories = await db.category.findMany({
				where: { userId: session.user.id },
				select: { id: true, name: true },
			});

			const categoryMap = new Map<string, string>();
			for (const c of categories) {
				categoryMap.set(c.name.toLowerCase(), c.id);
			}

			let successCount = 0;
			let skippedCount = 0;

			// 2. Process each row
			for (const row of rows) {
				const period = new Date(
					row.period.getFullYear(),
					row.period.getMonth(),
					1,
				);

				let categoryId: string | null = null;

				if (row.categoryName) {
					const id = categoryMap.get(row.categoryName.toLowerCase());
					if (id) {
						categoryId = id;
					} else {
						// Skip if category name is provided but not found
						skippedCount++;
						continue;
					}
				} else {
					// Global budget (null categoryId)
					categoryId = null;
				}

				// Upsert budget
				// Note: For global budget (categoryId=null), prisma upsert with composite key involving null might be tricky in some versions,
				// but explicit where clause usually works. However, prisma schema defines @@unique([userId, categoryId, period]).
				// If categoryId is null, unique constraint behavior depends on DB. PostgreSQL treats nulls as distinct for unique constraints unless defined otherwise.
				// BUT our schema uses `categoryId String?` and `@@unique`. In standard SQL, NULL != NULL.
				// However, we implemented `upsertGlobalBudget` using manual find/update/create to handle this safely.
				// We should do similar here.

				if (categoryId === null) {
					const existing = await db.budget.findFirst({
						where: {
							userId: session.user.id,
							categoryId: null,
							period,
						},
					});

					if (existing) {
						await db.budget.update({
							where: { id: existing.id },
							data: {
								amount: row.amount,
								// Global budgets don't use rollover/pegToActual typically, but schema supports it
							},
						});
					} else {
						await db.budget.create({
							data: {
								userId: session.user.id,
								categoryId: null,
								amount: row.amount,
								period,
							},
						});
					}
				} else {
					await db.budget.upsert({
						where: {
							userId_categoryId_period: {
								userId: session.user.id,
								categoryId,
								period,
							},
						},
						update: {
							amount: row.amount,
							isRollover: row.isRollover,
							rolloverAmount: row.rolloverAmount,
							pegToActual: row.pegToActual,
						},
						create: {
							userId: session.user.id,
							categoryId,
							amount: row.amount,
							period,
							isRollover: row.isRollover,
							rolloverAmount: row.rolloverAmount,
							pegToActual: row.pegToActual,
						},
					});
				}
				successCount++;
			}

			return { successCount, skippedCount };
		}),
});

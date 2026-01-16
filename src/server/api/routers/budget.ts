import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { formatDateOnly } from "~/lib/date";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getBestExchangeRate, sumExpensesForCurrency } from "./shared-currency";

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
			const { session, db } = ctx;

			const targetMonth = input.month ?? new Date();
			const startOfMonth = new Date(
				targetMonth.getFullYear(),
				targetMonth.getMonth(),
				1,
			);
			const endOfMonth = new Date(
				targetMonth.getFullYear(),
				targetMonth.getMonth() + 1,
				0,
				23,
				59,
				59,
				999,
			);

			const budgets = await db.budget.findMany({
				where: {
					userId: session.user.id,
					categoryId: { not: null },
					period: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
				},
				include: {
					category: {
						select: {
							id: true,
							name: true,
							color: true,
						},
					},
				},
				orderBy: {
					category: {
						name: "asc",
					},
				},
			});

			const budgetsWithSpend = await Promise.all(
				budgets.map(async (budget) => {
					const { total: actualSpend, totalInUSD: spendInUSDNumber } =
						await sumExpensesForCurrency(
							db,
							{
								userId: session.user.id,
								categoryId: budget.categoryId,
								date: {
									gte: startOfMonth,
									lte: endOfMonth,
								},
							},
							budget.currency,
						);

					const rate =
						(await getBestExchangeRate(db, budget.currency, new Date())) ?? 1;

					const budgetAmount =
						typeof budget.amount === "object" &&
						budget.amount !== null &&
						"toNumber" in budget.amount
							? budget.amount.toNumber()
							: Number(budget.amount);

					// Calculate USD-equivalent of budget amount for aggregation
					const amountInUSD = rate > 0 ? budgetAmount / rate : budgetAmount;

					const effectiveAmount = budget.pegToActual
						? actualSpend
						: budgetAmount;

					const effectiveAmountInUSD = budget.pegToActual
						? spendInUSDNumber
						: amountInUSD;

					return {
						...budget,
						amount: budgetAmount,
						amountInUSD,
						actualSpend,
						actualSpendInUSD: spendInUSDNumber,
						effectiveAmount,
						effectiveAmountInUSD,
					};
				}),
			);

			return budgetsWithSpend;
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
				},
				create: {
					userId: session.user.id,
					categoryId: input.categoryId,
					amount: input.amount,
					currency: input.currency,
					period: normalizedPeriod,
					isRollover: input.isRollover,
					pegToActual: input.pegToActual,
				},
				include: {
					category: {
						select: {
							id: true,
							name: true,
							color: true,
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

	getBudgetSuggestions: protectedProcedure
		.input(
			z.object({
				categoryId: z.string().cuid(),
				currency: z.string().length(3).optional().default("USD"),
			}),
		)
		.query(async ({ ctx, input }) => {
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

			const threeMonthsAgo = new Date();
			threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

			const monthlySpends: number[] = [];

			for (let i = 0; i < 3; i++) {
				const monthStart = new Date(
					threeMonthsAgo.getFullYear(),
					threeMonthsAgo.getMonth() + i,
					1,
				);
				const monthEnd = new Date(
					threeMonthsAgo.getFullYear(),
					threeMonthsAgo.getMonth() + i + 1,
					0,
					23,
					59,
					59,
					999,
				);

				const { total: amount } = await sumExpensesForCurrency(
					db,
					{
						userId: session.user.id,
						categoryId: input.categoryId,
						date: {
							gte: monthStart,
							lte: monthEnd,
						},
					},
					input.currency,
				);

				if (amount > 0) {
					monthlySpends.push(amount);
				}
			}

			if (monthlySpends.length === 0) {
				return {
					suggestedAmount: 0,
					averageSpend: 0,
					lastMonthSpend: 0,
				};
			}

			const averageSpend =
				monthlySpends.reduce((sum, value) => sum + value, 0) /
				monthlySpends.length;

			const lastMonthSpend = monthlySpends[monthlySpends.length - 1] ?? 0;

			monthlySpends.sort((a, b) => a - b);
			const mid = Math.floor(monthlySpends.length / 2);

			let median: number;
			if (monthlySpends.length % 2 === 0) {
				const lower = monthlySpends[mid - 1];
				const upper = monthlySpends[mid];
				if (lower !== undefined && upper !== undefined) {
					median = (lower + upper) / 2;
				} else {
					median = 0;
				}
			} else {
				median = monthlySpends[mid] ?? 0;
			}

			return {
				suggestedAmount: Math.round(median * 100) / 100,
				averageSpend: Math.round(averageSpend * 100) / 100,
				lastMonthSpend: Math.round(lastMonthSpend * 100) / 100,
			};
		}),

	getGlobalBudget: protectedProcedure
		.input(
			z.object({
				month: z.date().optional(), // Defaults to current month
			}),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const targetMonth = input.month ?? new Date();
			const startOfMonth = new Date(
				targetMonth.getFullYear(),
				targetMonth.getMonth(),
				1,
			);
			const endOfMonth = new Date(
				targetMonth.getFullYear(),
				targetMonth.getMonth() + 1,
				0,
				23,
				59,
				59,
				999,
			);

			const globalBudget = await db.budget.findFirst({
				where: {
					userId: session.user.id,
					categoryId: null,
					period: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
				},
			});

			if (!globalBudget) {
				return null;
			}

			const { totalInUSD: totalSpendAsNumber } = await sumExpensesForCurrency(
				db,
				{
					userId: session.user.id,
					date: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
				},
				globalBudget.currency,
			);

			const globalBudgetAmount =
				typeof globalBudget.amount === "object" &&
				globalBudget.amount !== null &&
				"toNumber" in globalBudget.amount
					? globalBudget.amount.toNumber()
					: Number(globalBudget.amount);

			// Convert global budget amount to USD for aggregation
			const rate =
				(await getBestExchangeRate(db, globalBudget.currency, new Date())) ?? 1;
			const amountInUSD =
				rate > 0 ? globalBudgetAmount / rate : globalBudgetAmount;

			return {
				...globalBudget,
				amount: globalBudgetAmount,
				amountInUSD,
				actualSpend: totalSpendAsNumber,
			};
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
			const { session, db } = ctx;

			// Normalize target month to start of month
			const targetPeriod = new Date(
				input.targetMonth.getFullYear(),
				input.targetMonth.getMonth(),
				1,
			);

			// Check if target month already has budgets
			const existingBudgets = await db.budget.findMany({
				where: {
					userId: session.user.id,
					period: targetPeriod,
					categoryId: {
						not: null, // Only category budgets, not global
					},
				},
			});

			if (existingBudgets.length > 0) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Budgets already exist for this month",
				});
			}

			// Find the most recent month with budgets (any month except target month)
			const lastBudget = await db.budget.findFirst({
				where: {
					userId: session.user.id,
					categoryId: {
						not: null, // Only category budgets, not global
					},
					period: {
						not: targetPeriod, // Any period except the target month
					},
				},
				orderBy: {
					period: "desc", // Most recent first
				},
				include: {
					category: {
						select: {
							id: true,
							name: true,
							color: true,
						},
					},
				},
			});

			if (!lastBudget) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No previous budgets found to copy from",
				});
			}

			// Find the month with the most budgets (the most recent month that has budgets)
			const budgetsByMonth = await db.budget.groupBy({
				by: ["period"],
				where: {
					userId: session.user.id,
					categoryId: {
						not: null, // Only category budgets, not global
					},
					period: {
						not: targetPeriod, // Any period except the target month
					},
				},
				_count: {
					period: true,
				},
				orderBy: {
					period: "desc", // Most recent first
				},
			});

			if (budgetsByMonth.length === 0 || !budgetsByMonth[0]) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No budgets found to copy from",
				});
			}

			// Get the most recent month with budgets
			const sourceMonth = budgetsByMonth[0].period;

			// Get all budgets from that month
			const sourceMonthStart = new Date(
				sourceMonth.getFullYear(),
				sourceMonth.getMonth(),
				1,
			);
			const sourceMonthEnd = new Date(
				sourceMonth.getFullYear(),
				sourceMonth.getMonth() + 1,
				0,
				23,
				59,
				59,
				999,
			);

			const sourceBudgets = await db.budget.findMany({
				where: {
					userId: session.user.id,
					categoryId: {
						not: null, // Only category budgets, not global
					},
					period: {
						gte: sourceMonthStart,
						lte: sourceMonthEnd,
					},
				},
				include: {
					category: {
						select: {
							id: true,
							name: true,
							color: true,
						},
					},
				},
			});

			if (sourceBudgets.length === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No budgets found in the most recent month",
				});
			}

			// Copy all budgets to target month
			const copiedBudgets = await Promise.all(
				sourceBudgets.map(async (sourceBudget) => {
					return await db.budget.create({
						data: {
							userId: session.user.id,
							categoryId: sourceBudget.categoryId,
							amount: sourceBudget.amount,
							period: targetPeriod,
							isRollover: sourceBudget.isRollover,
							pegToActual: sourceBudget.pegToActual,
						},
						include: {
							category: {
								select: {
									id: true,
									name: true,
									color: true,
								},
							},
						},
					});
				}),
			);

			// Convert Decimal types to numbers for frontend
			return copiedBudgets.map((budget) => ({
				...budget,
				amount:
					typeof budget.amount === "object" &&
					budget.amount !== null &&
					"toNumber" in budget.amount
						? budget.amount.toNumber()
						: Number(budget.amount),
			}));
		}),

	exportCsv: protectedProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		const budgets = await db.budget.findMany({
			where: {
				userId: session.user.id,
				// Include both category and global budgets (global has null categoryId)
			},
			orderBy: [{ period: "desc" }, { categoryId: "asc" }],
			include: {
				category: {
					select: {
						name: true,
					},
				},
			},
		});

		const header = [
			"categoryName",
			"amount",
			"period",
			"isRollover",
			"rolloverAmount",
			"pegToActual",
		];

		const escapeValue = (raw: unknown): string => {
			if (raw === null || raw === undefined) return "";
			const value =
				raw instanceof Date
					? formatDateOnly(raw)
					: typeof raw === "number" || typeof raw === "bigint"
						? raw.toString()
						: String(raw);

			const needsEscaping = /["\n,]/.test(value);
			if (!needsEscaping) return value;
			return `"${value.replace(/"/g, '""')}"`;
		};

		const rows = budgets.map((budget) => [
			escapeValue(budget.category?.name),
			escapeValue(budget.amount),
			escapeValue(budget.period),
			escapeValue(budget.isRollover),
			escapeValue(budget.rolloverAmount),
			escapeValue(budget.pegToActual),
		]);

		const csv = [header, ...rows].map((row) => row.join(",")).join("\n");

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

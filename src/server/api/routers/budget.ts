import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const budgetRouter = createTRPCRouter({
	getBudgets: protectedProcedure
		.input(
			z.object({
				month: z.date().optional(), // Defaults to current month
			}),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Default to current month if not provided
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
					categoryId: {
						// Exclude global budget (where categoryId is null)
						not: null,
					},
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

			// For each budget, calculate the actual spend for this month
			const budgetsWithSpend = await Promise.all(
				budgets.map(async (budget) => {
					const actualSpend = await db.expense.aggregate({
						where: {
							userId: session.user.id,
							categoryId: budget.categoryId,
							date: {
								gte: startOfMonth,
								lte: endOfMonth,
							},
							status: "FINALIZED",
						},
						_sum: {
							amountInUSD: true,
						},
					});

					const spend = actualSpend._sum.amountInUSD ?? 0;
					const spendAsNumber =
						typeof spend === "object" && spend !== null && "toNumber" in spend
							? spend.toNumber()
							: Number(spend);

					// Convert budget.amount to number if it's a Decimal
					const budgetAmount =
						typeof budget.amount === "object" &&
						budget.amount !== null &&
						"toNumber" in budget.amount
							? budget.amount.toNumber()
							: Number(budget.amount);

					// If pegToActual is true, the effective budget amount equals actual spend
					const effectiveAmount = budget.pegToActual
						? spendAsNumber
						: budgetAmount;

					return {
						...budget,
						amount: budgetAmount,
						actualSpend: spendAsNumber,
						effectiveAmount, // Add this for frontend calculations
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
				period: z.date(),
				isRollover: z.boolean().optional().default(false),
				pegToActual: z.boolean().optional().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Verify the category belongs to the user
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

			// Normalize period to start of month for consistency
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
					isRollover: input.isRollover,
					pegToActual: input.pegToActual,
				},
				create: {
					userId: session.user.id,
					categoryId: input.categoryId,
					amount: input.amount,
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

			// Convert Decimal types to numbers for frontend
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
			}),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Verify the category belongs to the user
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

			// Calculate the date 3 months ago
			const threeMonthsAgo = new Date();
			threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

			// Get monthly spend amounts for the last 3 months
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

				const spend = await db.expense.aggregate({
					where: {
						userId: session.user.id,
						categoryId: input.categoryId,
						date: {
							gte: monthStart,
							lte: monthEnd,
						},
						status: "FINALIZED",
					},
					_sum: {
						amountInUSD: true,
					},
				});

				const amount = Number(spend._sum.amountInUSD ?? 0);
				if (amount > 0) {
					monthlySpends.push(amount);
				}
			}

			// Calculate statistics for quick chips
			if (monthlySpends.length === 0) {
				return {
					suggestedAmount: 0,
					averageSpend: 0,
					lastMonthSpend: 0,
				};
			}

			// Calculate average
			const averageSpend =
				monthlySpends.reduce((sum, value) => sum + value, 0) /
				monthlySpends.length;

			// Last month spend is the most recent one (last element after sorting by time)
			const lastMonthSpend = monthlySpends[monthlySpends.length - 1] ?? 0;

			// Calculate median (for suggestedAmount)
			monthlySpends.sort((a, b) => a - b);
			const mid = Math.floor(monthlySpends.length / 2);

			let median: number;
			if (monthlySpends.length % 2 === 0) {
				// For even length, average the two middle values
				const lower = monthlySpends[mid - 1];
				const upper = monthlySpends[mid];
				if (lower !== undefined && upper !== undefined) {
					median = (lower + upper) / 2;
				} else {
					median = 0; // Fallback, though this shouldn't happen
				}
			} else {
				// For odd length, take the middle value
				median = monthlySpends[mid] ?? 0;
			}

			return {
				suggestedAmount: Math.round(median * 100) / 100, // Round to 2 decimal places
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

			// Default to current month if not provided
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
					categoryId: null, // Global budget has no category
					period: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
				},
			});

			if (!globalBudget) {
				return null;
			}

			// Calculate total spend for this month (across all categories)
			const totalSpend = await db.expense.aggregate({
				where: {
					userId: session.user.id,
					date: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
					status: "FINALIZED",
				},
				_sum: {
					amountInUSD: true,
				},
			});

			const totalSpendAmount = totalSpend._sum.amountInUSD ?? 0;
			const totalSpendAsNumber =
				typeof totalSpendAmount === "object" &&
				totalSpendAmount !== null &&
				"toNumber" in totalSpendAmount
					? totalSpendAmount.toNumber()
					: Number(totalSpendAmount);

			const globalBudgetAmount =
				typeof globalBudget.amount === "object" &&
				globalBudget.amount !== null &&
				"toNumber" in globalBudget.amount
					? globalBudget.amount.toNumber()
					: Number(globalBudget.amount);

			return {
				...globalBudget,
				amount: globalBudgetAmount,
				actualSpend: totalSpendAsNumber,
			};
		}),

	upsertGlobalBudget: protectedProcedure
		.input(
			z.object({
				amount: z.number().positive("Global budget amount must be positive"),
				period: z.date(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			// Normalize period to start of month for consistency
			const normalizedPeriod = new Date(
				input.period.getFullYear(),
				input.period.getMonth(),
				1,
			);

			// For global budgets (categoryId is null), we need to handle upsert manually
			// because Prisma's upsert doesn't work properly with composite unique constraints
			// that include nullable fields when the value is null
			const existingBudget = await db.budget.findFirst({
				where: {
					userId: session.user.id,
					categoryId: null, // Global budget has no category
					period: normalizedPeriod,
				},
			});

			let budget;
			if (existingBudget) {
				// Update existing global budget
				budget = await db.budget.update({
					where: {
						id: existingBudget.id,
					},
					data: {
						amount: input.amount,
					},
				});
			} else {
				// Create new global budget
				budget = await db.budget.create({
					data: {
						userId: session.user.id,
						categoryId: null, // Global budget has no category
						amount: input.amount,
						period: normalizedPeriod,
					},
				});
			}

			// Convert Decimal types to numbers for frontend
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

			// Verify the budget belongs to the user
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

			// Delete the budget
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

			// Normalize period to start of month for consistency
			const normalizedPeriod = new Date(
				input.period.getFullYear(),
				input.period.getMonth(),
				1,
			);

			// Delete the global budget for this period
			await db.budget.deleteMany({
				where: {
					userId: session.user.id,
					categoryId: null, // Global budget has no category
					period: normalizedPeriod,
				},
			});

			return { success: true };
		}),
});

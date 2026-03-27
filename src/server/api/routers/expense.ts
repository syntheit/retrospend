import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { CsvService } from "~/server/services/csv.service";
import { ExpenseService } from "~/server/services/expense.service";
import { getExcludedProjectIds, listSharedParticipationsForUser } from "~/server/services/shared-expense-integration";

const expenseInputSchema = z.object({
	id: z.string().uuid(),
	title: z.string().min(1).max(500),
	amount: z.number().positive("Amount must be positive"),
	currency: z.string().min(3).max(10).default(BASE_CURRENCY),
	exchangeRate: z.number().positive().optional(),
	amountInUSD: z.number().positive().optional(),
	pricingSource: z.string().max(200).optional(),
	date: z.date(),
	location: z.string().max(500).optional(),
	description: z.string().max(2000).optional(),
	categoryId: z.string().cuid().optional(),
	amortizeOver: z.number().int().min(2).max(60).optional(),
	excludeFromAnalytics: z.boolean().optional(),
});

export const expenseRouter = createTRPCRouter({
	updateExpense: protectedProcedure
		.input(expenseInputSchema)
		.mutation(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.updateExpense(ctx.session.user.id, input);
		}),

	createExpense: protectedProcedure
		.input(expenseInputSchema)
		.mutation(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.createExpense(ctx.session.user.id, input);
		}),

	listFinalized: protectedProcedure
		.input(
			z
				.object({
					from: z.date().optional(),
					to: z.date().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			const expenses = await service.listFinalized(
				ctx.session.user.id,
				input?.from,
				input?.to,
			);
			return expenses.map((e) => ({
				...e,
				amount: Number(e.amount),
				amountInUSD: e.amountInUSD !== null ? Number(e.amountInUSD) : null,
				exchangeRate: e.exchangeRate !== null ? Number(e.exchangeRate) : null,
			}));
		}),

	getExpense: protectedProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			const expense = await service.getExpense(ctx.session.user.id, input.id);
			if (!expense)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Expense not found",
				});
			return {
				...expense,
				amount: Number(expense.amount),
				amountInUSD:
					expense.amountInUSD !== null ? Number(expense.amountInUSD) : null,
				exchangeRate:
					expense.exchangeRate !== null ? Number(expense.exchangeRate) : null,
			};
		}),

	getExpensesByDate: protectedProcedure
		.input(z.object({ date: z.date() }))
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			const expenses = await service.getExpensesByDate(
				ctx.session.user.id,
				input.date,
			);
			return expenses.map((e) => ({
				...e,
				amount: Number(e.amount),
				amountInUSD: e.amountInUSD !== null ? Number(e.amountInUSD) : null,
				exchangeRate: e.exchangeRate !== null ? Number(e.exchangeRate) : null,
			}));
		}),

	deleteExpense: protectedProcedure
		.input(z.object({ id: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.deleteExpense(ctx.session.user.id, input.id);
		}),

	exportCsv: protectedProcedure
		.input(
			z
				.object({ expenseIds: z.array(z.string().uuid()).optional() })
				.optional(),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new CsvService(ctx.db);
			const csv = await service.exportExpensesAsCsv(
				ctx.session.user.id,
				input?.expenseIds,
			);
			return { csv };
		}),

	importExpenses: protectedProcedure
		.input(
			z.object({
				rows: z
					.array(
						z.object({
							title: z.string().min(1),
							amount: z.number().positive(),
							currency: z.string().min(3).max(10),
							date: z.date(),
							exchangeRate: z.number().positive().optional(),
							amountInUSD: z.number().positive().optional(),
							location: z.string().nullable().optional(),
							description: z.string().nullable().optional(),
							categoryId: z.string().cuid().nullable().optional(),
							pricingSource: z.string().nullable().optional(),
							isAmortized: z.boolean().optional().default(false),
							amortizeDuration: z.number().int().min(2).max(60).optional(),
						}),
					)
					.min(1)
					.max(1000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new CsvService(ctx.db);
			try {
				return await service.importExpensesFromRows(
					ctx.session.user.id,
					input.rows,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to import expenses",
				});
			}
		}),

	bulkUpdateCategory: protectedProcedure
		.input(
			z.object({
				expenseIds: z.array(z.string().uuid()).min(1).max(500),
				categoryId: z.string().cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.bulkUpdateCategory(
				ctx.session.user.id,
				input.expenseIds,
				input.categoryId,
			);
		}),

	getCategorySpending: protectedProcedure
		.input(
			z.object({
				categoryId: z.string().cuid(),
				month: z.date(),
				targetCurrency: z.string().min(3).max(10).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.getCategorySpending(
				ctx.session.user.id,
				input.categoryId,
				input.month,
				input.targetCurrency,
			);
		}),

	getTotalSpending: protectedProcedure
		.input(
			z.object({
				month: z.date(),
				targetCurrency: z.string().min(3).max(10).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.getTotalSpending(
				ctx.session.user.id,
				input.month,
				input.targetCurrency,
			);
		}),
	getFilterOptions: protectedProcedure.query(async ({ ctx }) => {
		const service = new ExpenseService(ctx.db);
		return await service.getFilterOptions(ctx.session.user.id);
	}),

	/**
	 * Returns the current user's shared expense participations as
	 * transaction-like records for the unified transactions feed.
	 * Each record shows the user's share amount, not the full transaction.
	 */
	listSharedParticipations: protectedProcedure.query(async ({ ctx }) => {
		const excludedProjectIds = await getExcludedProjectIds(ctx.db, ctx.session.user.id);
		return await listSharedParticipationsForUser(ctx.db, ctx.session.user.id, excludedProjectIds);
	}),

	/**
	 * Checks if a potential duplicate expense exists (same title + amount + date).
	 * Used to warn users before creating a duplicate.
	 */
	checkDuplicate: protectedProcedure
		.input(
			z.object({
				title: z.string().min(1),
				amount: z.number().positive(),
				date: z.date(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const startOfDay = new Date(input.date);
			startOfDay.setHours(0, 0, 0, 0);
			const endOfDay = new Date(input.date);
			endOfDay.setHours(23, 59, 59, 999);

			const match = await ctx.db.expense.findFirst({
				where: {
					userId: ctx.session.user.id,
					title: { equals: input.title, mode: "insensitive" },
					amount: { equals: input.amount },
					date: { gte: startOfDay, lte: endOfDay },
				},
				select: { id: true, title: true },
			});

			return match
				? { isDuplicate: true, existingTitle: match.title }
				: { isDuplicate: false, existingTitle: null };
		}),

	/**
	 * Returns autocomplete suggestions for the expense title field.
	 * Searches both personal expenses and shared transactions the user participates in.
	 * Grouped by title (case-insensitive), ordered by frequency.
	 */
	titleSuggestions: protectedProcedure
		.input(z.object({ query: z.string().min(1).max(100) }))
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const query = input.query;

			const [expenseGroups, sharedGroups] = await Promise.all([
				ctx.db.expense.groupBy({
					by: ["title"],
					where: {
						userId,
						title: { contains: query, mode: "insensitive" },
					},
					_count: { title: true },
					orderBy: { _count: { title: "desc" } },
					take: 15,
				}),
				ctx.db.sharedTransaction.groupBy({
					by: ["description"],
					where: {
						description: { contains: query, mode: "insensitive" },
						splitParticipants: {
							some: { participantType: "user", participantId: userId },
						},
					},
					_count: { description: true },
					orderBy: { _count: { description: "desc" } },
					take: 15,
				}),
			]);

			// Merge counts by title (case-insensitive), preserving canonical casing
			const countMap = new Map<string, number>();
			const canonicalTitle = new Map<string, string>();
			for (const g of expenseGroups) {
				const key = g.title.toLowerCase();
				if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.title);
				countMap.set(key, (countMap.get(key) ?? 0) + g._count.title);
			}
			for (const g of sharedGroups) {
				const key = g.description.toLowerCase();
				if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.description);
				countMap.set(key, (countMap.get(key) ?? 0) + g._count.description);
			}

			const sorted = [...countMap.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 8);

			if (sorted.length === 0) return [];

			// Get the most recent expense's categoryId for each top title
			const topTitles = sorted.map(([key]) => canonicalTitle.get(key) ?? key);
			const recentExpenses = await ctx.db.expense.findMany({
				where: { userId, title: { in: topTitles } },
				orderBy: { date: "desc" },
				select: { title: true, categoryId: true, amount: true, currency: true },
				distinct: ["title"],
			});

			const categoryByTitle = new Map<string, string | null>();
			const amountByTitle = new Map<string, { amount: number; currency: string }>();
			for (const e of recentExpenses) {
				const key = e.title.toLowerCase();
				if (!categoryByTitle.has(key)) categoryByTitle.set(key, e.categoryId);
				if (!amountByTitle.has(key)) amountByTitle.set(key, { amount: Number(e.amount), currency: e.currency });
			}

			return sorted.map(([lowKey, count]) => ({
				title: canonicalTitle.get(lowKey) ?? lowKey,
				count,
				lastCategoryId: categoryByTitle.get(lowKey) ?? null,
				lastAmount: amountByTitle.get(lowKey)?.amount ?? null,
				lastCurrency: amountByTitle.get(lowKey)?.currency ?? null,
			}));
		}),
});

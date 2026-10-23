import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { customRateSchema } from "~/lib/schemas/rate";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { CsvService } from "~/server/services/csv.service";
import { ExpenseService } from "~/server/services/expense.service";
import { expenseDto, listHomeCurrency } from "~/server/services/expense-dto";
import {
	getExcludedProjectIds,
	listSharedParticipationsForUser,
} from "~/server/services/shared-expense-integration";
import { titleSuggestions } from "~/server/services/title-suggestions.service";

const expenseInputSchema = z.object({
	id: z.guid(),
	title: z.string().min(1).max(500),
	amount: z.number().positive("Amount must be positive"),
	currency: z.string().min(3).max(10).default(BASE_CURRENCY),
	exchangeRate: z.number().positive().optional(),
	amountInUSD: z.number().positive().optional(),
	pricingSource: z.string().max(200).optional(),
	/** The pair's rate type (official, blue...) or "custom" with customRate. */
	rateType: z.string().min(1).max(32).optional(),
	customRate: z
		.object({ base: z.string().min(3).max(10), value: customRateSchema })
		.optional(),
	date: z.date(),
	location: z.string().max(500).optional(),
	description: z.string().max(2000).optional(),
	categoryId: z.cuid().optional(),
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
					limit: z.number().int().min(1).max(100).optional(), // newest first
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			const [expenses, home] = await Promise.all([
				service.listFinalized(
					ctx.session.user.id,
					input?.from,
					input?.to,
					input?.limit,
				),
				listHomeCurrency(ctx.db, ctx.session.user.id),
			]);
			return expenses.map((e) => expenseDto(e, home));
		}),

	getExpense: protectedProcedure
		.input(z.object({ id: z.guid() }))
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			const expense = await service.getExpense(ctx.session.user.id, input.id);
			if (!expense)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Expense not found",
				});
			return expenseDto(
				expense,
				await listHomeCurrency(ctx.db, ctx.session.user.id),
			);
		}),

	getExpensesByDate: protectedProcedure
		.input(z.object({ date: z.date() }))
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			const [expenses, home] = await Promise.all([
				service.getExpensesByDate(ctx.session.user.id, input.date),
				listHomeCurrency(ctx.db, ctx.session.user.id),
			]);
			return expenses.map((e) => expenseDto(e, home));
		}),

	deleteExpense: protectedProcedure
		.input(z.object({ id: z.guid() }))
		.mutation(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.deleteExpense(ctx.session.user.id, input.id);
		}),

	exportCsv: protectedProcedure
		.input(z.object({ expenseIds: z.array(z.guid()).optional() }).optional())
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
							categoryId: z.cuid().nullable().optional(),
							pricingSource: z.string().nullable().optional(),
							isAmortized: z.boolean().optional().default(false),
							amortizeDuration: z.number().int().min(2).max(60).optional(),
							excludeFromAnalytics: z.boolean().optional(),
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
					{ timeZone: ctx.timeZone },
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
				expenseIds: z.array(z.guid()).min(1).max(500),
				categoryId: z.cuid(),
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
		const excludedProjectIds = await getExcludedProjectIds(
			ctx.db,
			ctx.session.user.id,
		);
		return await listSharedParticipationsForUser(
			ctx.db,
			ctx.session.user.id,
			excludedProjectIds,
		);
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
			const service = new ExpenseService(ctx.db);
			const match = await service.findDuplicate(ctx.session.user.id, input);
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
		.query(async ({ ctx, input }) =>
			titleSuggestions(ctx.db, ctx.session.user.id, input.query),
		),
});

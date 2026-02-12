import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { CsvService } from "~/server/services/csv.service";
import { ExpenseService } from "~/server/services/expense.service";

const expenseInputSchema = z.object({
	id: z.string().uuid(),
	title: z.string(),
	amount: z.number().positive("Amount must be positive"),
	currency: z.string().length(3).default(BASE_CURRENCY),
	exchangeRate: z.number().positive().optional(),
	amountInUSD: z.number().positive().optional(),
	pricingSource: z.string().optional(),
	date: z.date(),
	location: z.string().optional(),
	description: z.string().optional(),
	categoryId: z.string().cuid().optional(),
	amortizeOver: z.number().int().min(2).max(60).optional(),
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
			return await service.listFinalized(
				ctx.session.user.id,
				input?.from,
				input?.to,
			);
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
			return expense;
		}),

	getExpensesByDate: protectedProcedure
		.input(z.object({ date: z.date() }))
		.query(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.getExpensesByDate(ctx.session.user.id, input.date);
		}),

	deleteExpense: protectedProcedure
		.input(z.object({ id: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const service = new ExpenseService(ctx.db);
			return await service.deleteExpense(ctx.session.user.id, input.id);
		}),

	exportCsv: protectedProcedure
		.input(z.object({ expenseIds: z.array(z.string()).optional() }).optional())
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
							currency: z.string().length(3),
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

	getCategorySpending: protectedProcedure
		.input(
			z.object({
				categoryId: z.string().cuid(),
				month: z.date(),
				targetCurrency: z.string().length(3).optional(),
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
				targetCurrency: z.string().length(3).optional(),
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
});

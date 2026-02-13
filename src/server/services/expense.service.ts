import { TRPCError } from "@trpc/server";
import { BASE_CURRENCY } from "~/lib/constants";
import type { Prisma, PrismaClient } from "~prisma";
import {
	getBestExchangeRate,
	sumExpensesForCurrency,
} from "../api/routers/shared-currency";
import { AmortizationService } from "./amortization.service";

export class ExpenseService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	async createExpense(
		userId: string,
		input: {
			id: string;
			title: string;
			amount: number;
			currency: string;
			exchangeRate?: number;
			amountInUSD?: number;
			pricingSource?: string;
			date: Date;
			location?: string;
			description?: string;
			categoryId?: string;
			amortizeOver?: number;
		},
	) {
		if (input.categoryId) {
			const category = await (this.db as PrismaClient).category.findFirst({
				where: { id: input.categoryId, userId },
			});
			if (!category) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Category not found",
				});
			}
		}

		let exchangeRate = input.exchangeRate;
		let amountInUSD = input.amountInUSD;
		const pricingSource = input.pricingSource ?? "MANUAL";

		if (!exchangeRate) {
			if (input.currency === BASE_CURRENCY) {
				exchangeRate = 1;
			} else {
				const bestRate = await getBestExchangeRate(
					this.db as PrismaClient,
					input.currency,
					input.date,
				);
				if (bestRate) {
					exchangeRate = bestRate;
				} else {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Exchange rate not found for ${input.currency}.`,
					});
				}
			}
		}

		if (!amountInUSD) {
			amountInUSD = input.amount / (exchangeRate ?? 1);
		}

		return await this.runInTransaction(async (tx) => {
			const expense = await tx.expense.create({
				data: {
					id: input.id,
					userId,
					title: input.title,
					amount: input.amount,
					currency: input.currency,
					exchangeRate: exchangeRate,
					amountInUSD: amountInUSD,
					pricingSource: pricingSource,
					date: input.date,
					location: input.location,
					description: input.description,
					categoryId: input.categoryId,
					status: "FINALIZED",
					isAmortizedParent: (input.amortizeOver ?? 0) > 1,
				},
				include: {
					category: true,
				},
			});

			if (input.amortizeOver && input.amortizeOver > 1) {
				const amortization = new AmortizationService(tx);
				await amortization.syncAmortization(expense, input.amortizeOver);
			}

			return expense;
		});
	}

	async updateExpense(
		userId: string,
		input: {
			id: string;
			title: string;
			amount: number;
			currency: string;
			exchangeRate?: number;
			amountInUSD?: number;
			pricingSource?: string;
			date: Date;
			location?: string;
			description?: string;
			categoryId?: string;
			amortizeOver?: number;
		},
	) {
		const existingExpense = await (this.db as PrismaClient).expense.findFirst({
			where: { id: input.id, userId },
		});

		if (!existingExpense) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
		}

		return await this.runInTransaction(async (tx) => {
			const expense = await tx.expense.update({
				where: { id: input.id, userId },
				data: {
					title: input.title,
					amount: input.amount,
					currency: input.currency,
					exchangeRate: input.exchangeRate,
					amountInUSD: input.amountInUSD,
					pricingSource: input.pricingSource,
					date: input.date,
					location: input.location || null,
					description: input.description || null,
					categoryId: input.categoryId || null,
					isAmortizedParent: (input.amortizeOver ?? 0) > 1,
				},
			});

			const amortization = new AmortizationService(tx);
			await amortization.syncAmortization(expense, input.amortizeOver ?? 0);

			return expense;
		});
	}

	async deleteExpense(userId: string, id: string) {
		const expense = await (this.db as PrismaClient).expense.findFirst({
			where: { id, userId },
			select: { id: true, isAmortizedParent: true },
		});

		if (!expense) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
		}

		await this.runInTransaction(async (tx) => {
			if (expense.isAmortizedParent) {
				await tx.expense.deleteMany({
					where: { parentId: id, userId },
				});
			}
			await tx.expense.delete({ where: { id } });
		});

		return { success: true };
	}

	async listFinalized(userId: string, from?: Date, to?: Date) {
		return await (this.db as PrismaClient).expense.findMany({
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedChild: false,
				...(from || to
					? {
							date: {
								...(from ? { gte: from } : {}),
								...(to ? { lte: to } : {}),
							},
						}
					: {}),
			},
			orderBy: { date: "desc" },
			include: { category: true },
		});
	}

	async getExpense(userId: string, id: string) {
		return await (this.db as PrismaClient).expense.findFirst({
			where: { id, userId },
			include: { category: true, children: { select: { id: true } } },
		});
	}

	async getExpensesByDate(userId: string, date: Date) {
		const startOfDay = new Date(date);
		startOfDay.setHours(0, 0, 0, 0);

		const endOfDay = new Date(date);
		endOfDay.setHours(23, 59, 59, 999);

		return await (this.db as PrismaClient).expense.findMany({
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedChild: false,
				date: {
					gte: startOfDay,
					lte: endOfDay,
				},
			},
			orderBy: {
				date: "desc",
			},
			include: {
				category: true,
			},
		});
	}

	async getCategorySpending(
		userId: string,
		categoryId: string,
		month: Date,
		targetCurrency = BASE_CURRENCY,
	) {
		const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
		const endOfMonth = new Date(
			month.getFullYear(),
			month.getMonth() + 1,
			0,
			23,
			59,
			59,
			999,
		);

		const { total } = await sumExpensesForCurrency(
			this.db as PrismaClient,
			{
				userId,
				categoryId,
				isAmortizedParent: false,
				date: { gte: startOfMonth, lte: endOfMonth },
			},
			targetCurrency,
			month,
		);

		return { total, categoryId };
	}

	async getTotalSpending(
		userId: string,
		month: Date,
		targetCurrency = BASE_CURRENCY,
	) {
		const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
		const endOfMonth = new Date(
			month.getFullYear(),
			month.getMonth() + 1,
			0,
			23,
			59,
			59,
			999,
		);

		const { total } = await sumExpensesForCurrency(
			this.db as PrismaClient,
			{
				userId,
				isAmortizedParent: false,
				date: { gte: startOfMonth, lte: endOfMonth },
			},
			targetCurrency,
			month,
		);

		return { total };
	}

	async getFilterOptions(userId: string) {
		const [yearsResult, categories] = await Promise.all([
			(this.db as PrismaClient).$queryRaw<{ year: number }[]>`
				SELECT DISTINCT EXTRACT(YEAR FROM date)::INT as year 
				FROM expense 
				WHERE "userId" = ${userId} 
				ORDER BY year DESC
			`,
			(this.db as PrismaClient).category.findMany({
				where: { userId },
				select: { id: true, name: true, color: true },
				orderBy: { name: "asc" },
			}),
		]);

		return {
			years: yearsResult.map((r) => r.year),
			categories: categories.map((c) => ({
				...c,
				usageCount: 0, // Usage count calculation remains client-side or simplified
			})),
		};
	}

	private async runInTransaction<T>(
		callback: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		if ("$transaction" in this.db) {
			return await this.db.$transaction(callback);
		}
		return await callback(this.db as Prisma.TransactionClient);
	}
}

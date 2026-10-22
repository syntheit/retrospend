import { TRPCError } from "@trpc/server";
import { computeAmountInUSD, isValidRate, USD } from "~/lib/money";
import type { Prisma, PrismaClient } from "~prisma";
import { requireExchangeRate } from "../exchange-rates";
import { AmortizationService } from "./amortization.service";
import { listedEntryWhere } from "./spending";

/** pricingSource of a rate the user typed in by hand. */
export const CUSTOM_PRICING_SOURCE = "custom";

function sameRate(a: number, b: number): boolean {
	return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-6;
}

/**
 * Works out the stored exchangeRate and amountInUSD of an expense on the
 * server. The client's amountInUSD is never used. Its exchangeRate is kept
 * only when it is a custom rate the user typed, or the rate already stored on
 * the expense being edited. Anything else comes from the rate table for the
 * expense date, using the pricingSource rate type when it exists.
 */
export async function resolveExpenseRate(
	db: PrismaClient | Prisma.TransactionClient,
	input: {
		amount: number;
		currency: string;
		date: Date;
		exchangeRate?: number;
		pricingSource?: string | null;
	},
	existing?: { currency: string; exchangeRate: number } | null,
): Promise<{ exchangeRate: number; amountInUSD: number }> {
	let exchangeRate: number;

	if (input.currency === USD) {
		exchangeRate = 1;
	} else if (
		input.pricingSource === CUSTOM_PRICING_SOURCE &&
		isValidRate(input.exchangeRate)
	) {
		exchangeRate = input.exchangeRate;
	} else if (
		existing &&
		existing.currency === input.currency &&
		isValidRate(existing.exchangeRate) &&
		(input.exchangeRate === undefined ||
			sameRate(input.exchangeRate, existing.exchangeRate))
	) {
		// Editing without touching the rate keeps the rate of its own day.
		exchangeRate = existing.exchangeRate;
	} else {
		const picked = await requireExchangeRate(
			db,
			input.currency,
			input.date,
			input.pricingSource,
		);
		exchangeRate = picked.rate;
	}

	return {
		exchangeRate,
		amountInUSD: computeAmountInUSD(input.amount, input.currency, exchangeRate),
	};
}

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
			excludeFromAnalytics?: boolean;
			projectId?: string;
		},
	) {
		let categoryExcludeByDefault = false;
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
			categoryExcludeByDefault = category.excludeByDefault;
		}

		const pricingSource = input.pricingSource ?? "MANUAL";
		const { exchangeRate, amountInUSD } = await resolveExpenseRate(
			this.db,
			input,
		);

		// Determine excludeFromAnalytics: explicit input > category default > false
		// Project expenses always have excludeFromAnalytics: false
		const excludeFromAnalytics = input.projectId
			? false
			: (input.excludeFromAnalytics ?? categoryExcludeByDefault);

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
					excludeFromAnalytics,
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
		}, userId);
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
			excludeFromAnalytics?: boolean;
		},
	) {
		const existingExpense = await (this.db as PrismaClient).expense.findFirst({
			where: { id: input.id, userId },
		});

		if (!existingExpense) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
		}

		// Determine excludeFromAnalytics for the update
		let excludeFromAnalytics: boolean | undefined = input.excludeFromAnalytics;

		// A changed category must belong to the user, same as on create. An
		// unchanged category is left alone so editing never trips on it.
		if (input.categoryId && input.categoryId !== existingExpense.categoryId) {
			const newCategory = await (this.db as PrismaClient).category.findFirst({
				where: { id: input.categoryId, userId },
				select: { excludeByDefault: true },
			});
			if (!newCategory) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Category not found",
				});
			}
			// If the user didn't explicitly set the flag, apply the new category's default
			if (excludeFromAnalytics === undefined && newCategory.excludeByDefault) {
				excludeFromAnalytics = true;
			}
		}

		const { exchangeRate, amountInUSD } = await resolveExpenseRate(
			this.db,
			input,
			{
				currency: existingExpense.currency,
				exchangeRate: Number(existingExpense.exchangeRate),
			},
		);

		return await this.runInTransaction(async (tx) => {
			const expense = await tx.expense.update({
				where: { id: input.id, userId },
				data: {
					title: input.title,
					amount: input.amount,
					currency: input.currency,
					exchangeRate,
					amountInUSD,
					pricingSource: input.pricingSource,
					date: input.date,
					location: input.location || null,
					description: input.description || null,
					categoryId: input.categoryId || null,
					isAmortizedParent: (input.amortizeOver ?? 0) > 1,
					...(excludeFromAnalytics !== undefined && { excludeFromAnalytics }),
				},
			});

			const amortization = new AmortizationService(tx);
			await amortization.syncAmortization(expense, input.amortizeOver ?? 0);

			return expense;
		}, userId);
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
		}, userId);

		return { success: true };
	}

	async listFinalized(userId: string, from?: Date, to?: Date, limit?: number) {
		return await (this.db as PrismaClient).expense.findMany({
			where: {
				...listedEntryWhere(userId),
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
			...(limit ? { take: limit } : {}),
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
				...listedEntryWhere(userId),
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

	async bulkUpdateCategory(
		userId: string,
		expenseIds: string[],
		categoryId: string,
	) {
		const category = await (this.db as PrismaClient).category.findFirst({
			where: { id: categoryId, userId },
			select: { id: true, name: true },
		});
		if (!category) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Category not found",
			});
		}

		return await this.runInTransaction(async (tx) => {
			const result = await tx.expense.updateMany({
				where: { id: { in: expenseIds }, userId },
				data: { categoryId },
			});
			return { count: result.count, categoryName: category.name };
		}, userId);
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
		userId?: string,
	): Promise<T> {
		if ("$transaction" in this.db) {
			if (userId) {
				return await this.db.$transaction(async (tx) => {
					await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
					                            set_config('role', 'retrospend_app', true)`;
					return await callback(tx);
				});
			}
			return await this.db.$transaction(callback);
		}
		return await callback(this.db as Prisma.TransactionClient);
	}
}

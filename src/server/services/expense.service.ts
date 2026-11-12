import {
	type RateChoice,
	type RateInput,
	rateChoice as chooseRate,
	type SavedRate,
	storedAmount,
} from "@retrospend/domain/rate-booking";
import {
	dayKey,
	parseDateOnlyIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import { CUSTOM_RATE_TYPE } from "~/lib/rate-selection";
import { userTransaction } from "~/server/db-tx";
import type { Prisma, PrismaClient } from "~prisma";
import { refuseLegMoneyEdit } from "./accounts/leg-edits";
import { AmortizationService } from "./amortization.service";
import { type RestoreToken, readRowRestore } from "./entry/restore-token";
import { findDuplicateExpense } from "./expense-duplicate";
import {
	asBadRequest,
	type BookedRate,
	bookRate,
	loadRateContext,
} from "./rate-types";
import { listedEntryWhere } from "./spending";
import { sortByText } from "./text-order";

/** pricingSource of a rate the user typed in by hand. */
export const CUSTOM_PRICING_SOURCE = CUSTOM_RATE_TYPE;

export type { RateInput, SavedRate };

/** The domain's rateChoice, with bad input as a BAD_REQUEST. */
export function rateChoice(
	input: RateInput,
	saved: SavedRate | null | undefined,
	homeCurrency: string,
): RateChoice {
	return asBadRequest(() => chooseRate(input, saved, homeCurrency));
}

/**
 * Works out both legs of an expense's rate on the server: the entry leg
 * (exchangeRate, amountInUSD) and the home leg booked once (rateType,
 * homeCurrency, homeRate, homeAmount), so the entry never drifts with later
 * rates. The client's amountInUSD is never used. A missing rate throws
 * MissingRateError: saving is blocked, never done at 0 or 1.
 */
export async function resolveExpenseRate(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	input: RateInput,
	saved?: SavedRate | null,
): Promise<BookedRate> {
	const ctx = await loadRateContext(db, userId);
	return bookRate(
		db,
		ctx,
		{
			amount: storedAmount(input.amount),
			currency: input.currency,
			date: input.date,
		},
		rateChoice(input, saved, ctx.homeCurrency),
		saved,
	);
}

/** The kind of signed restore an expense edit's undo carries (restore-token.ts). */
export const EXPENSE_RESTORE = "expense.update";

/** The booked rate columns of a row as stored, as decimal text. */
export interface SavedFigures {
	exchangeRate: string;
	amountInUSD: string;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
	homeAmount: string | null;
}

/** The rate columns of a saved expense row, and the money it booked. */
function savedRateOf(row: {
	currency: string;
	exchangeRate: Prisma.Decimal | number;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: Prisma.Decimal | null;
	amount: Prisma.Decimal;
	date: Date;
	amountInUSD: Prisma.Decimal;
	homeAmount: Prisma.Decimal | null;
}): SavedRate {
	return {
		currency: row.currency,
		exchangeRate: Number(row.exchangeRate),
		rateType: row.rateType,
		homeCurrency: row.homeCurrency,
		homeRate: row.homeRate?.toString() ?? null,
		amount: row.amount.toString(),
		date: row.date,
		amountInUSD: row.amountInUSD.toString(),
		homeAmount: row.homeAmount?.toString() ?? null,
	};
}

export interface CreateExpenseInput {
	id: string;
	title: string;
	amount: number | string;
	currency: string;
	exchangeRate?: number;
	amountInUSD?: number;
	pricingSource?: string;
	rateType?: string;
	customRate?: { base: string; value: string; home?: string };
	date: Date;
	location?: string;
	description?: string;
	categoryId?: string;
	amortizeOver?: number;
	excludeFromAnalytics?: boolean;
	projectId?: string;
}

/**
 * Creates an expense (spending, never money in) with every read and write on
 * `tx`, so the expense.create money mutation can preview it in a transaction
 * that rolls back. Callers outside a transaction use ExpenseService.
 */
export async function createExpenseIn(
	tx: Prisma.TransactionClient,
	userId: string,
	input: CreateExpenseInput,
) {
	let categoryExcludeByDefault = false;
	if (input.categoryId) {
		const category = await tx.category.findFirst({
			where: { id: input.categoryId, userId, kind: "EXPENSE" },
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
	const rate = await resolveExpenseRate(tx, userId, input);

	// Determine excludeFromAnalytics: explicit input > category default > false
	// Project expenses always have excludeFromAnalytics: false
	const excludeFromAnalytics = input.projectId
		? false
		: (input.excludeFromAnalytics ?? categoryExcludeByDefault);

	const expense = await tx.expense.create({
		data: {
			id: input.id,
			userId,
			title: input.title,
			amount: storedAmount(input.amount),
			currency: input.currency,
			...rate,
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
}

export class ExpenseService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	async createExpense(userId: string, input: CreateExpenseInput) {
		return await this.runInTransaction(
			(tx) => createExpenseIn(tx, userId, input),
			userId,
		);
	}

	async updateExpense(
		userId: string,
		input: {
			id: string;
			title: string;
			amount: number | string;
			currency: string;
			exchangeRate?: number;
			amountInUSD?: number;
			pricingSource?: string;
			rateType?: string;
			customRate?: { base: string; value: string; home?: string };
			date: Date;
			location?: string;
			description?: string;
			categoryId?: string;
			amortizeOver?: number;
			excludeFromAnalytics?: boolean;
			/** Set only by the undo of an edit: the figures it was saved with, signed, written back as they were. */
			restore?: RestoreToken | null;
		},
	) {
		const existingExpense = await (this.db as PrismaClient).expense.findFirst({
			where: { id: input.id, userId },
			include: { _count: { select: { accountLegs: true } } },
		});

		if (!existingExpense) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
		}
		refuseLegMoneyEdit(existingExpense, input);

		// Determine excludeFromAnalytics for the update
		let excludeFromAnalytics: boolean | undefined = input.excludeFromAnalytics;

		// A changed category must belong to the user, same as on create. An
		// unchanged category is left alone so editing never trips on it.
		if (input.categoryId && input.categoryId !== existingExpense.categoryId) {
			const newCategory = await (this.db as PrismaClient).category.findFirst({
				where: { id: input.categoryId, userId, kind: "EXPENSE" },
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

		// An undo puts back what was stored; booking again could round differently.
		const rate = input.restore
			? await this.restoredFigures(userId, { ...input, restore: input.restore })
			: await resolveExpenseRate(
					this.db,
					userId,
					input,
					savedRateOf(existingExpense),
				);

		return await this.runInTransaction(async (tx) => {
			const expense = await tx.expense.update({
				where: { id: input.id, userId },
				data: {
					title: input.title,
					amount: storedAmount(input.amount),
					currency: input.currency,
					...rate,
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

	/** See findDuplicateExpense. */
	async findDuplicate(
		userId: string,
		input: Parameters<typeof findDuplicateExpense>[2],
		options?: Parameters<typeof findDuplicateExpense>[3],
	) {
		return findDuplicateExpense(
			this.db as PrismaClient,
			userId,
			input,
			options,
		);
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
			where: { id: categoryId, userId, kind: "EXPENSE" },
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
		// Raw SQL runs inside a user transaction (role and RLS set), never on a
		// bare scoped client.
		const { yearsResult, categories } = await this.runInTransaction(
			async (tx) => ({
				yearsResult: await tx.$queryRaw<{ year: number }[]>`
					SELECT DISTINCT EXTRACT(YEAR FROM date)::INT as year 
					FROM expense 
					WHERE "userId" = ${userId} 
					ORDER BY year DESC
				`,
				categories: await tx.category.findMany({
					where: { userId },
					select: { id: true, name: true, color: true },
				}),
			}),
			userId,
		);

		return {
			years: yearsResult.map((r) => r.year),
			// By name, sorted here: a name may be ciphertext in the database (text-order.ts).
			categories: sortByText(categories, (c) => c.name).map((c) => ({
				...c,
				usageCount: 0, // Usage count calculation remains client-side or simplified
			})),
		};
	}

	/**
	 * The figures an edit's undo signed, once they prove to be this row's: its
	 * id, amount, currency and date, under the home the user still has.
	 */
	private async restoredFigures(
		userId: string,
		input: {
			id: string;
			amount: number | string;
			currency: string;
			date: Date;
			restore: RestoreToken;
		},
	): Promise<SavedFigures> {
		const user = await (this.db as PrismaClient).user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		});
		return readRowRestore<SavedFigures>(input.restore, {
			kind: EXPENSE_RESTORE,
			id: input.id,
			amount: storedAmount(input.amount),
			currency: input.currency,
			date: input.date.toISOString(),
			home: user?.homeCurrency ?? "",
		});
	}

	private async runInTransaction<T>(
		callback: (tx: Prisma.TransactionClient) => Promise<T>,
		userId?: string,
	): Promise<T> {
		if ("$transaction" in this.db) {
			if (userId) return await userTransaction(this.db, userId, callback);
			return await this.db.$transaction(callback);
		}
		return await callback(this.db as Prisma.TransactionClient);
	}
}

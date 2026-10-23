import { TRPCError } from "@trpc/server";
import { isValidRate, USD } from "~/lib/money";
import {
	CUSTOM_RATE_TYPE,
	rateTypeFromPricingSource,
} from "~/lib/rate-selection";
import type { Prisma, PrismaClient } from "~prisma";
import { AmortizationService } from "./amortization.service";
import { listActivity } from "./expense-list";
import type { ListV2Filter } from "./expense-list/types";
import {
	type BookedRate,
	bookRate,
	loadRateContext,
	type RateChoice,
} from "./rate-types";
import { listedEntryWhere } from "./spending";

/** pricingSource of a rate the user typed in by hand. */
export const CUSTOM_PRICING_SOURCE = CUSTOM_RATE_TYPE;

function sameRate(a: number, b: number): boolean {
	return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-6;
}

/** What the form sends about an entry's rate. */
export interface RateInput {
	amount: number;
	currency: string;
	date: Date;
	/** Entry leg in the stored convention: kept when custom or unchanged on edit. */
	exchangeRate?: number;
	/** Legacy: the entry leg's rate type, or a placeholder (MANUAL, IMPORT). */
	pricingSource?: string | null;
	/** The pair's rate type picked on the Add sheet (a table type or "custom"). */
	rateType?: string;
	/** A typed rate between entry and home: 1 `base` = `value` of the other. */
	customRate?: { base: string; value: number };
}

/** The rate an expense was saved with. */
export interface SavedRate {
	currency: string;
	exchangeRate: number;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
}

/** Editing without touching the rate: same currency, same rate, same type. */
function untouched(input: RateInput, saved: SavedRate): boolean {
	return (
		saved.currency === input.currency &&
		isValidRate(saved.exchangeRate) &&
		(input.exchangeRate === undefined ||
			sameRate(input.exchangeRate, saved.exchangeRate)) &&
		(input.rateType === undefined || input.rateType === saved.rateType)
	);
}

/**
 * How an entry's rate is chosen (pure, so every rule is unit tested):
 * - a typed cross rate (the Add sheet's Custom) wins;
 * - an edit that leaves the rate alone keeps both legs (its home leg when it
 *   was booked in today's home, else the home leg is booked now);
 * - the old form's custom rate keeps its entry leg;
 * - anything else comes from the table for the entry date, of the picked
 *   type on both legs. Without one, the old form's pricingSource picks the
 *   entry leg only (it sends "official" for EUR and BRL on its own, and
 *   "official" for USD, whose leg has no type) and the home leg takes the
 *   user's default.
 */
export function rateChoice(
	input: RateInput,
	saved: SavedRate | null | undefined,
	homeCurrency: string,
): RateChoice {
	if (input.customRate) return { kind: "custom", ...input.customRate };
	const legacyType = rateTypeFromPricingSource(input.pricingSource);
	if (saved && untouched(input, saved)) {
		if (saved.homeCurrency === homeCurrency && saved.homeRate) {
			return {
				kind: "kept",
				exchangeRate: saved.exchangeRate,
				homeRate: saved.homeRate,
				rateType: saved.rateType,
			};
		}
		return {
			kind: "entryLeg",
			exchangeRate: saved.exchangeRate,
			rateType: saved.rateType ?? legacyType,
		};
	}
	const entryType = input.currency === USD ? null : legacyType;
	if ((input.rateType ?? entryType) === CUSTOM_RATE_TYPE) {
		if (input.currency !== USD && isValidRate(input.exchangeRate)) {
			return {
				kind: "entryLeg",
				exchangeRate: input.exchangeRate,
				rateType: CUSTOM_RATE_TYPE,
			};
		}
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Enter the custom rate",
		});
	}
	if (input.rateType !== undefined) {
		return { kind: "table", rateType: input.rateType };
	}
	return { kind: "table", rateType: null, entryType };
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
		{ amount: input.amount, currency: input.currency, date: input.date },
		rateChoice(input, saved, ctx.homeCurrency),
	);
}

/** The rate columns of a saved expense row. */
function savedRateOf(row: {
	currency: string;
	exchangeRate: Prisma.Decimal | number;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: Prisma.Decimal | null;
}): SavedRate {
	return {
		currency: row.currency,
		exchangeRate: Number(row.exchangeRate),
		rateType: row.rateType,
		homeCurrency: row.homeCurrency,
		homeRate: row.homeRate?.toString() ?? null,
	};
}

export interface CreateExpenseInput {
	id: string;
	title: string;
	amount: number;
	currency: string;
	exchangeRate?: number;
	amountInUSD?: number;
	pricingSource?: string;
	rateType?: string;
	customRate?: { base: string; value: number };
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
			amount: input.amount,
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
			amount: number;
			currency: string;
			exchangeRate?: number;
			amountInUSD?: number;
			pricingSource?: string;
			rateType?: string;
			customRate?: { base: string; value: number };
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

		const rate = await resolveExpenseRate(
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
					amount: input.amount,
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

	/**
	 * The Activity list (v2): personal expenses, your shares and payments in
	 * one cursor-paginated read, with multi-select filters and accent-blind
	 * search. Shaping lives in ./expense-list.
	 */
	async listV2(userId: string, filter: ListV2Filter, timeZone?: string) {
		return listActivity(this.db, userId, filter, timeZone);
	}

	async getExpense(userId: string, id: string) {
		return await (this.db as PrismaClient).expense.findFirst({
			where: { id, userId },
			include: { category: true, children: { select: { id: true } } },
		});
	}

	/** An expense with the same title (any case), amount and day, for the duplicate warning. */
	async findDuplicate(
		userId: string,
		input: { title: string; amount: number; date: Date },
	) {
		const startOfDay = new Date(input.date);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(input.date);
		endOfDay.setHours(23, 59, 59, 999);

		return await (this.db as PrismaClient).expense.findFirst({
			where: {
				// Money in never makes an expense look like a duplicate.
				...listedEntryWhere(userId),
				title: { equals: input.title, mode: "insensitive" },
				amount: { equals: input.amount },
				date: { gte: startOfDay, lte: endOfDay },
			},
			select: { id: true, title: true },
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

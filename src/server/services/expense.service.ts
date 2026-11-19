import { expenseCategory } from "@retrospend/domain/expense-write/category";
import { bookCreate } from "@retrospend/domain/expense-write/create";
import {
	checkEditCategory as checkStoredCategory,
	type DeleteHooks,
	deleteExpense as deleteStoredExpense,
	type EditInput,
	type EditOptions,
	type EditResult,
	editExpense as editStoredExpense,
	type SavedFigures,
} from "@retrospend/domain/expense-write/edit";
import {
	ANY_POLICY,
	type EditPolicy,
} from "@retrospend/domain/expense-write/policy";
import {
	type RateInput,
	type SavedRate,
	storedAmount,
} from "@retrospend/domain/rate-booking";
import { TRPCError } from "@trpc/server";
import { CUSTOM_RATE_TYPE } from "~/lib/rate-selection";
import { userTransaction } from "~/server/db-tx";
import type { Prisma, PrismaClient } from "~prisma";
import { AmortizationService } from "./amortization.service";
import { bookContextOf, expenseEditPort } from "./entry/expense-edit.prisma";
import { type RestoreToken, readRowRestore } from "./entry/restore-token";
import { findDuplicateExpense } from "./expense-duplicate";
import { asBadRequestAsync } from "./rate-types";
import { listedEntryWhere } from "./spending";
import { sortByText } from "./text-order";

/** pricingSource of a rate the user typed in by hand. */
export const CUSTOM_PRICING_SOURCE = CUSTOM_RATE_TYPE;

export type { RateInput, SavedRate };

/** The kind of signed restore an expense edit's undo carries (restore-token.ts). */
export const EXPENSE_RESTORE = "expense.update";

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
	const category = input.categoryId
		? expenseCategory(
				await tx.category.findFirst({
					where: { id: input.categoryId, userId },
					select: { id: true, kind: true, excludeByDefault: true },
				}),
				"not_found",
			)
		: undefined;
	// Bad rate input is a BAD_REQUEST, as on every rate path here.
	const { plan, booked: rate } = await asBadRequestAsync(async () =>
		bookCreate(await bookContextOf(tx, userId), input, category),
	);
	const pricingSource = input.pricingSource ?? "MANUAL";

	const expense = await tx.expense.create({
		data: {
			id: input.id,
			userId,
			title: input.title,
			amount: plan.amount,
			currency: input.currency,
			...rate,
			pricingSource: pricingSource,
			date: input.date,
			location: input.location,
			description: input.description,
			categoryId: input.categoryId,
			status: "FINALIZED",
			isAmortizedParent: (input.amortizeOver ?? 0) > 1,
			excludeFromAnalytics: plan.excludeFromAnalytics,
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

/** The fields the expense form saves; `restore` is set only by the undo of an edit. */
export interface UpdateExpenseInput extends Omit<EditInput, "pricingSource"> {
	pricingSource?: string;
	/** Old forms send it; the server books its own and never reads it. */
	amountInUSD?: number;
	/** The figures the edit was saved with, signed, written back as they were. */
	restore?: RestoreToken | null;
}

export class ExpenseService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	async createExpense(userId: string, input: CreateExpenseInput) {
		return await this.runInTransaction(
			(tx) => createExpenseIn(tx, userId, input),
			userId,
		);
	}

	/**
	 * Edits an expense on the domain core, in one transaction. `policy` says
	 * which rows are reachable; the legacy callers keep every row of the
	 * person's. Returns the core's before and after, and the row as stored.
	 */
	async editExpense(
		userId: string,
		input: UpdateExpenseInput,
		policy: EditPolicy,
		options: Pick<EditOptions, "categoryFirst" | "afterRead"> = {},
	): Promise<EditResult & { row: Prisma.ExpenseGetPayload<object> }> {
		return await this.runInTransaction(async (tx) => {
			const port = expenseEditPort(tx, userId);
			const spread = new AmortizationService(tx);
			const { restore } = input;
			const done = await asBadRequestAsync(() =>
				editStoredExpense(port, input, policy, {
					...options,
					// An undo puts back what was stored; booking again could round differently.
					restoredFigures: restore
						? () => this.restoredFigures(tx, userId, { ...input, restore })
						: undefined,
					afterWrite: (after, amortizeOver) =>
						spread.syncAmortization({ ...after, userId }, amortizeOver),
				}),
			);
			return { ...done, row: port.written() };
		}, userId);
	}

	/** The category rule of an edit alone (v1 asks it ahead of a stamp compare). */
	async checkEditCategory(userId: string, input: UpdateExpenseInput) {
		await this.runInTransaction(
			(tx) => checkStoredCategory(expenseEditPort(tx, userId), input),
			userId,
		);
	}

	/** The legacy edit: every row of the person's, the stored row back. */
	async updateExpense(userId: string, input: UpdateExpenseInput) {
		return (await this.editExpense(userId, input, ANY_POLICY)).row;
	}

	/** Deletes an expense and its spread parts; `policy` defaults to every row of the person's. */
	async deleteExpense(
		userId: string,
		id: string,
		options: {
			policy?: EditPolicy;
			beforeRemove?: DeleteHooks["beforeRemove"];
		} = {},
	) {
		await this.runInTransaction(
			(tx) =>
				deleteStoredExpense(
					expenseEditPort(tx, userId),
					id,
					options.policy ?? ANY_POLICY,
					{ beforeRemove: options.beforeRemove },
				),
			userId,
		);
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
		tx: Prisma.TransactionClient,
		userId: string,
		input: {
			id: string;
			amount: number | string;
			currency: string;
			date: Date;
			restore: RestoreToken;
		},
	): Promise<SavedFigures> {
		const user = await tx.user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		});
		return readRowRestore<SavedFigures>(
			input.restore,
			EXPENSE_RESTORE,
			userId,
			{
				id: input.id,
				amount: storedAmount(input.amount),
				currency: input.currency,
				date: input.date.toISOString(),
				home: user?.homeCurrency ?? "",
				bound: {},
			},
		);
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

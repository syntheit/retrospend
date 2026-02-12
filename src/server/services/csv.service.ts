import { randomUUID } from "node:crypto";
import { BASE_CURRENCY } from "~/lib/constants";
import { generateCsv } from "~/lib/csv";
import { formatDateOnly } from "~/lib/date";
import type { Prisma, PrismaClient } from "~prisma";
import { AmortizationService } from "./amortization.service";

type ExportExpensePayload = Prisma.ExpenseGetPayload<{
	include: {
		category: {
			select: {
				id: true;
				name: true;
				color: true;
			};
		};
		children: {
			select: {
				id: true;
			};
		};
	};
}>;

export interface ImportExpenseRow {
	title: string;
	amount: number;
	currency: string;
	date: Date;
	exchangeRate?: number;
	amountInUSD?: number;
	location?: string | null;
	description?: string | null;
	categoryId?: string | null;
	pricingSource?: string | null;
	isAmortized?: boolean;
	amortizeDuration?: number;
}

export class CsvService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	/**
	 * Exports expenses for a user as a CSV string.
	 */
	async exportExpensesAsCsv(userId: string, expenseIds?: string[]) {
		const expenses = await this.db.expense.findMany({
			where: {
				userId: userId,
				status: "FINALIZED",
				isAmortizedChild: false, // Only export parents, not children
				...(expenseIds ? { id: { in: expenseIds } } : {}),
			},
			orderBy: {
				date: "desc",
			},
			include: {
				category: {
					select: {
						id: true,
						name: true,
						color: true,
					},
				},
				children: {
					select: {
						id: true,
					},
				},
			},
		});

		const header = [
			"title",
			"amount",
			"currency",
			"exchangeRate",
			"amountInUSD",
			"date",
			"location",
			"description",
			"pricingSource",
			"category",
			"isAmortized",
			"amortizeDuration",
		];

		const rows = expenses.map((expense: ExportExpensePayload) => [
			expense.title,
			expense.amount,
			expense.currency,
			expense.exchangeRate,
			expense.amountInUSD,
			expense.date,
			expense.location,
			expense.description,
			expense.pricingSource,
			expense.category?.name,
			expense.isAmortizedParent ? "true" : "false",
			expense.isAmortizedParent && expense.children
				? expense.children.length
				: "",
		]);

		return generateCsv(header, rows);
	}

	/**
	 * Processes and imports expenses from raw rows.
	 */
	async importExpensesFromRows(userId: string, rows: ImportExpenseRow[]) {
		const categoryIds = Array.from(
			new Set(
				rows
					.map((row) => row.categoryId)
					.filter((id): id is string => Boolean(id)),
			),
		);

		let validCategoryIds = new Set<string>();
		if (categoryIds.length > 0) {
			const categories = await this.db.category.findMany({
				where: {
					id: { in: categoryIds },
					userId: userId,
				},
				select: { id: true },
			});
			validCategoryIds = new Set(
				categories.map((category: { id: string }) => category.id),
			);
		}

		let totalCreated = 0;

		for (const row of rows) {
			const exchangeRate =
				row.exchangeRate ??
				(row.currency.toUpperCase() === BASE_CURRENCY ? 1 : null);
			const amountInUSD =
				row.amountInUSD ?? (exchangeRate ? row.amount / exchangeRate : null);

			if (!exchangeRate || !amountInUSD) {
				throw new Error(
					`Missing exchange rate or USD amount for ${row.currency} on row: ${row.title}`,
				);
			}

			const categoryId =
				row.categoryId && validCategoryIds.has(row.categoryId)
					? row.categoryId
					: null;

			const baseExpenseData = {
				userId: userId,
				title: row.title,
				amount: row.amount,
				currency: row.currency.toUpperCase(),
				date: row.date,
				categoryId: categoryId ?? undefined,
				amountInUSD: amountInUSD,
				exchangeRate: exchangeRate,
				pricingSource: row.pricingSource ?? "IMPORT",
				location: row.location ?? undefined,
				description: row.description ?? undefined,
				status: "FINALIZED" as const,
			};

			const duration = row.amortizeDuration;
			if (row.isAmortized && duration && duration > 1) {
				await this.runInTransaction(async (tx: Prisma.TransactionClient) => {
					const expense = await tx.expense.create({
						data: {
							...baseExpenseData,
							id: randomUUID(),
							isAmortizedParent: true,
						},
					});

					const amortizationService = new AmortizationService(tx);
					await amortizationService.syncAmortization(expense, duration);
				});

				totalCreated += 1 + duration;
			} else {
				await this.db.expense.create({
					data: {
						...baseExpenseData,
						id: randomUUID(),
					},
				});

				totalCreated += 1;
			}
		}

		return { count: totalCreated };
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

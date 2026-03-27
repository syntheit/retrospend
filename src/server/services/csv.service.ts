import { randomUUID } from "node:crypto";
import { BASE_CURRENCY } from "~/lib/constants";
import { generateCsv } from "~/lib/csv";
import type { Prisma, PrismaClient } from "~prisma";
import { toUSD } from "~/server/currency";
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
			"excludeFromAnalytics",
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
			expense.excludeFromAnalytics ? "true" : "false",
		]);

		return generateCsv(header, rows);
	}

	/**
	 * Processes and imports expenses from raw rows.
	 */
	async importExpensesFromRows(userId: string, rows: ImportExpenseRow[]) {
		// Validate categories
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

		// Fetch existing expenses in the date range to detect duplicates
		const dates = Array.from(new Set(rows.map((row) => row.date)));
		const existingExpenses = await this.db.expense.findMany({
			where: {
				userId: userId,
				date: { in: dates },
				status: "FINALIZED",
			},
			select: { date: true, title: true, amount: true, currency: true },
		});

		// Build fingerprint set for duplicate detection
		const existingFingerprints = new Set(
			existingExpenses.map((e) => {
				const dateStr = e.date.toISOString().split("T")[0];
				return `${dateStr}|${e.title.trim()}|${Math.abs(Number(e.amount))}|${e.currency.toUpperCase()}`;
			}),
		);

		let totalCreated = 0;
		let skippedDuplicates = 0;

		type PreparedRow = { data: ImportExpenseRow; exchangeRate: number; amountInUSD: number; categoryId: string | null };

		const buildExpenseData = (r: PreparedRow) => ({
			id: randomUUID(),
			userId: userId,
			title: r.data.title,
			amount: r.data.amount,
			currency: r.data.currency.toUpperCase(),
			date: r.data.date,
			categoryId: r.categoryId ?? undefined,
			amountInUSD: r.amountInUSD,
			exchangeRate: r.exchangeRate,
			pricingSource: r.data.pricingSource ?? "IMPORT",
			location: r.data.location ?? undefined,
			description: r.data.description ?? undefined,
			status: "FINALIZED" as const,
		});

		// Separate rows into batch-eligible (non-amortized) and sequential (amortized)
		const batchRows: PreparedRow[] = [];
		const amortizedRows: PreparedRow[] = [];

		for (const row of rows) {
			const dateStr = row.date.toISOString().split("T")[0];
			const fingerprint = `${dateStr}|${row.title.trim()}|${Math.abs(row.amount)}|${row.currency.toUpperCase()}`;

			if (existingFingerprints.has(fingerprint)) {
				skippedDuplicates++;
				continue;
			}

			const exchangeRate =
				row.exchangeRate ??
				(row.currency.toUpperCase() === BASE_CURRENCY ? 1 : null);
			const amountInUSD =
				row.amountInUSD ?? (exchangeRate ? toUSD(row.amount, row.currency, exchangeRate) : null);

			if (!exchangeRate || !amountInUSD) {
				throw new Error(
					`Missing exchange rate or USD amount for ${row.currency} on row: ${row.title}`,
				);
			}

			const categoryId =
				row.categoryId && validCategoryIds.has(row.categoryId)
					? row.categoryId
					: null;

			const prepared = { data: row, exchangeRate, amountInUSD, categoryId };
			const duration = row.amortizeDuration;

			if (row.isAmortized && duration && duration > 1) {
				amortizedRows.push(prepared);
			} else {
				batchRows.push(prepared);
			}

			existingFingerprints.add(fingerprint);
		}

		// Batch create all non-amortized rows in one call
		if (batchRows.length > 0) {
			await this.runInTransaction(userId, async (tx: Prisma.TransactionClient) => {
				await tx.expense.createMany({
					data: batchRows.map((r) => buildExpenseData(r)),
				});
			});
			totalCreated += batchRows.length;
		}

		// Process amortized rows in a single transaction (each is independent)
		if (amortizedRows.length > 0) {
			await this.runInTransaction(userId, async (tx: Prisma.TransactionClient) => {
				const amortizationService = new AmortizationService(tx);
				for (const r of amortizedRows) {
					const duration = r.data.amortizeDuration!;
					const expense = await tx.expense.create({
						data: {
							...buildExpenseData(r),
							isAmortizedParent: true,
						},
					});
					await amortizationService.syncAmortization(expense, duration);
				}
			});
			totalCreated += amortizedRows.reduce(
				(sum, r) => sum + 1 + r.data.amortizeDuration!,
				0,
			);
		}

		return { count: totalCreated, skippedDuplicates };
	}

	private async runInTransaction<T>(
		userId: string,
		callback: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		if ("$transaction" in this.db) {
			return await this.db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
				                            set_config('role', 'retrospend_app', true)`;
				return await callback(tx);
			});
		}
		return await callback(this.db as Prisma.TransactionClient);
	}
}

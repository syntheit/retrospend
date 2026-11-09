import { randomUUID } from "node:crypto";
import {
	SealedTextError,
	stripUserTextControls,
	stripUserTextControlsForKey,
} from "@retrospend/api-contract/common";
import {
	computeAmountInUSD,
	isValidRate,
	type PickedRate,
	rateFromUsdPerUnit,
	roundUSD,
	USD,
} from "@retrospend/domain/money";
import {
	dayKey,
	startOfDayIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import { generateCsv } from "~/lib/csv";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import type { Prisma, PrismaClient } from "~prisma";
import { AmortizationService } from "./amortization.service";
import { listedEntryWhere } from "./spending";

/**
 * Stored rate and USD amount of an imported row. A rate in the file wins
 * (amountInUSD is recomputed from it), then a USD amount (the rate is derived
 * from it), then the rate table for the row's date. Never a rate of 1.
 */
export function resolveImportRate(
	row: {
		title: string;
		amount: number;
		currency: string;
		date: Date;
		exchangeRate?: number;
		amountInUSD?: number;
	},
	rateFor: (currency: string, date: Date) => PickedRate | null,
): { exchangeRate: number; amountInUSD: number } {
	const currency = row.currency.toUpperCase();
	if (currency === USD) {
		return { exchangeRate: 1, amountInUSD: roundUSD(row.amount) };
	}
	if (isValidRate(row.exchangeRate)) {
		return {
			exchangeRate: row.exchangeRate,
			amountInUSD: computeAmountInUSD(row.amount, currency, row.exchangeRate),
		};
	}
	if (isValidRate(row.amountInUSD)) {
		return {
			exchangeRate: rateFromUsdPerUnit(currency, row.amountInUSD / row.amount),
			amountInUSD: roundUSD(row.amountInUSD),
		};
	}
	const picked = rateFor(currency, row.date);
	if (!picked) {
		throw new Error(
			`Missing exchange rate or USD amount for ${row.currency} on row: ${row.title}`,
		);
	}
	return {
		exchangeRate: picked.rate,
		amountInUSD: computeAmountInUSD(row.amount, currency, picked.rate),
	};
}

/** C0 controls other than tab, line feed and carriage return. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is what it matches
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/**
 * What makes an imported row "already in Activity": the same calendar day in
 * the user's zone (an expense saved at any time of that day counts), title,
 * amount and currency. The import review and both import writers use it.
 */
export function importFingerprint(
	date: Date,
	title: string,
	amount: number,
	currency: string,
	timeZone?: string,
): string {
	return `${dayKey(date, timeZone)}|${title.trim()}|${Math.abs(amount)}|${currency.toUpperCase()}`;
}

/**
 * The fingerprints a title can have been stored as. A control character in a
 * file's title is a separator in one form ("COFFEE\vSHOP" kept as is, or read
 * from the file) and gone in the other (stored with its controls stripped), so
 * two titles are the same row when any of their fingerprints agree.
 */
export function importFingerprints(
	date: Date,
	title: string,
	amount: number,
	currency: string,
	timeZone?: string,
): string[] {
	// Never throws: `title` may be a stored row, and a legacy title that starts
	// with U+0001 must not stop an import. Incoming rows are refused before this.
	const keys = [
		title.replace(CONTROLS, " "),
		stripUserTextControlsForKey(title),
	].map((t) => importFingerprint(date, t, amount, currency, timeZone));
	return [...new Set(keys)];
}

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
	/** Unset means the category's excludeByDefault (like the expense form). */
	excludeFromAnalytics?: boolean;
}

/** An imported row the service refused, by its place in the rows it was given. */
export interface RejectedImportRow {
	row: number;
	reason: string;
}

export const SEALED_TEXT_REASON =
	"Text starts with a reserved character (U+0001)";

/** The row with the characters userText refuses taken out of its text. Throws SealedTextError for text that starts with U+0001. */
function withCleanText(row: ImportExpenseRow): ImportExpenseRow {
	const clean = (text: string | null | undefined) =>
		text ? stripUserTextControls(text) : text;
	return {
		...row,
		title: stripUserTextControls(row.title),
		location: clean(row.location),
		description: clean(row.description),
	};
}

export class CsvService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	/**
	 * Exports expenses for a user as a CSV string.
	 */
	async exportExpensesAsCsv(userId: string, expenseIds?: string[]) {
		const expenses = await this.db.expense.findMany({
			where: {
				...listedEntryWhere(userId),
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
	async importExpensesFromRows(
		userId: string,
		incoming: ImportExpenseRow[],
		options: { timeZone?: string } = {},
	) {
		const tz = options.timeZone;
		// The text is stored cleaned; the duplicate check also reads the file's own.
		// A row whose text starts with U+0001 (the marker of an encrypted value)
		// is refused, not cleaned: stripping it would store the ciphertext as text.
		const rejected: RejectedImportRow[] = [];
		const rows: ImportExpenseRow[] = [];
		const sources: ImportExpenseRow[] = [];
		for (const [at, row] of incoming.entries()) {
			try {
				rows.push(withCleanText(row));
				sources.push(row);
			} catch (error) {
				if (!(error instanceof SealedTextError)) throw error;
				rejected.push({ row: at, reason: SEALED_TEXT_REASON });
			}
		}
		// Validate categories
		const categoryIds = Array.from(
			new Set(
				rows
					.map((row) => row.categoryId)
					.filter((id): id is string => Boolean(id)),
			),
		);

		// Valid category ids and whether each excludes from analytics by default
		const categoryExcludes = new Map<string, boolean>();
		if (categoryIds.length > 0) {
			const categories = await this.db.category.findMany({
				where: {
					id: { in: categoryIds },
					userId: userId,
				},
				select: { id: true, excludeByDefault: true },
			});
			for (const category of categories) {
				categoryExcludes.set(category.id, category.excludeByDefault);
			}
		}

		const fingerprints = (
			date: Date,
			title: string,
			amount: number,
			currency: string,
		) => importFingerprints(date, title, amount, currency, tz);

		const times = rows.map((row) => row.date.getTime());
		const existingExpenses =
			rows.length === 0
				? []
				: await this.db.expense.findMany({
						where: {
							// Money in never blocks an imported expense as a duplicate.
							...listedEntryWhere(userId),
							date: {
								gte: startOfDayIn(new Date(Math.min(...times)), tz),
								lt: startOfNextDayIn(new Date(Math.max(...times)), tz),
							},
							status: "FINALIZED",
						},
						select: { date: true, title: true, amount: true, currency: true },
					});

		// Build fingerprint set for duplicate detection
		const existingFingerprints = new Set(
			existingExpenses.flatMap((e) =>
				fingerprints(e.date, e.title, Number(e.amount), e.currency),
			),
		);

		let totalCreated = 0;
		let skippedDuplicates = 0;

		// Table rates for rows that bring neither a rate nor a USD amount.
		const rateFor = await findExchangeRatesForDates(
			this.db,
			rows
				.filter(
					(r) => !isValidRate(r.exchangeRate) && !isValidRate(r.amountInUSD),
				)
				.map((r) => r.currency.toUpperCase()),
		);

		type PreparedRow = {
			data: ImportExpenseRow;
			exchangeRate: number;
			amountInUSD: number;
			categoryId: string | null;
			excludeFromAnalytics: boolean;
		};

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
			excludeFromAnalytics: r.excludeFromAnalytics,
			status: "FINALIZED" as const,
		});

		// Separate rows into batch-eligible (non-amortized) and sequential (amortized)
		const batchRows: PreparedRow[] = [];
		const amortizedRows: PreparedRow[] = [];

		for (const [at, row] of rows.entries()) {
			const rowFingerprints = fingerprints(
				row.date,
				sources[at]?.title ?? row.title,
				row.amount,
				row.currency,
			);

			if (rowFingerprints.some((key) => existingFingerprints.has(key))) {
				skippedDuplicates++;
				continue;
			}

			const { exchangeRate, amountInUSD } = resolveImportRate(row, rateFor);

			const categoryId =
				row.categoryId && categoryExcludes.has(row.categoryId)
					? row.categoryId
					: null;
			// Explicit column > category default > counted
			const excludeFromAnalytics =
				row.excludeFromAnalytics ??
				(categoryId ? (categoryExcludes.get(categoryId) ?? false) : false);

			const prepared = {
				data: row,
				exchangeRate,
				amountInUSD,
				categoryId,
				excludeFromAnalytics,
			};
			const duration = row.amortizeDuration;

			if (row.isAmortized && duration && duration > 1) {
				amortizedRows.push(prepared);
			} else {
				batchRows.push(prepared);
			}

			for (const key of rowFingerprints) existingFingerprints.add(key);
		}

		// Batch create all non-amortized rows in one call
		if (batchRows.length > 0) {
			await this.runInTransaction(
				userId,
				async (tx: Prisma.TransactionClient) => {
					await tx.expense.createMany({
						data: batchRows.map((r) => buildExpenseData(r)),
					});
				},
			);
			totalCreated += batchRows.length;
		}

		// Process amortized rows in a single transaction (each is independent)
		if (amortizedRows.length > 0) {
			await this.runInTransaction(
				userId,
				async (tx: Prisma.TransactionClient) => {
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
				},
			);
			totalCreated += amortizedRows.reduce(
				(sum, r) => sum + 1 + r.data.amortizeDuration!,
				0,
			);
		}

		return { count: totalCreated, skippedDuplicates, rejected };
	}

	private async runInTransaction<T>(
		userId: string,
		callback: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		if ("$transaction" in this.db) {
			return await userTransaction(this.db, userId, callback);
		}
		return await callback(this.db as Prisma.TransactionClient);
	}
}

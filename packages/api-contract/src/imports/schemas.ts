import * as z from "zod";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { idSchema, timestampSchema } from "../core";
import { daySchema } from "../ledger";

/** The queue refuses bigger files (ImportQueueService MAX_FILE_SIZE). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export const IMPORT_FILE_TYPES = ["csv", "xlsx", "pdf"] as const;

/** What the reader does with the file: a spreadsheet of rows, or a bank statement. */
export const IMPORT_SOURCES = ["csv", "bank_statement"] as const;

/** What a row becomes when it is imported. Mirrors IMPORT_KINDS on the server. */
export const IMPORT_ROW_KINDS = [
	"expense",
	"income",
	"refund",
	"notSpending",
] as const;

export const IMPORT_STATES = [
	"queued",
	"reading",
	"ready",
	"reviewing",
	"imported",
	"failed",
	"cancelled",
] as const;

export const importStateSchema = z
	.enum(IMPORT_STATES)
	.meta({ id: "ImportState" });

/**
 * One import file and where it stands. Neither the file nor its rows are
 * here: the rows come from the review route.
 */
export const importJobSchema = z
	.object({
		id: idSchema,
		fileName: z.string(),
		fileType: z.enum(IMPORT_FILE_TYPES),
		source: z.enum(IMPORT_SOURCES),
		state: importStateSchema,
		/** 0 to 100 while a bank statement is read, when the reader reports it. */
		percent: z.int().min(0).max(100).nullable(),
		/** The reader's latest note ("Reading page 2 of 4"). */
		message: z.string().nullable(),
		/** Rows the reader found; 0 until it has read the file. */
		rowCount: z.int().min(0),
		/** Rows created by the import, once imported. */
		importedCount: z.int().min(0).nullable(),
		skippedDuplicates: z.int().min(0).nullable(),
		warnings: z.array(z.string()),
		error: z.string().nullable(),
		createdAt: timestampSchema,
		completedAt: timestampSchema.nullable(),
	})
	.meta({ id: "ImportJob" });

export type ImportJobDto = z.infer<typeof importJobSchema>;

export const importUploadSchema = z.object({
	file: z.file().max(IMPORT_MAX_BYTES).meta({
		description:
			"A CSV, XLSX or PDF file of at most 10 MB (multipart/form-data, field file).",
	}),
	source: z.enum(IMPORT_SOURCES).default("csv").meta({
		description:
			"csv for a spreadsheet of expenses, bank_statement for a bank statement (PDF or CSV).",
	}),
});

export const importJobParamsSchema = z.object({ id: idSchema });

export const importReviewQuerySchema = importJobParamsSchema.extend({
	currency: currencyCodeSchema.optional().meta({
		description: "Read every row as this currency instead of the file's own.",
	}),
});

const importReviewRowSchema = z
	.object({
		index: z.int().min(0),
		date: daySchema,
		title: z.string(),
		amount: moneySchema,
		/** The home value the import saves; null when there is no rate yet. */
		home: moneySchema.nullable(),
		rate: z
			.object({
				unit: moneySchema,
				value: moneySchema,
				type: z.string().nullable(),
			})
			.nullable(),
		fileCategory: z.string(),
		categoryId: idSchema.nullable(),
		kind: z.enum(IMPORT_ROW_KINDS),
		/** Exact: this row is already in Activity; the import skips it. */
		duplicate: z.boolean(),
		/** Likely: an Activity row with the same amount within 3 days. */
		possible: z.object({ title: z.string(), date: daySchema }).nullable(),
		/** No rate at all for its currency: it cannot be saved. */
		noRate: z.boolean(),
	})
	.meta({ id: "ImportReviewRow" });

export const importReviewSchema = z
	.object({
		jobId: idSchema,
		fileName: z.string(),
		source: z.enum(IMPORT_SOURCES),
		homeCurrency: currencyCodeSchema,
		rows: z.array(importReviewRowSchema),
		/** Always add up: fileRows = readable rows + unreadable. */
		counts: z.object({
			fileRows: z.int().min(0),
			unreadable: z.int().min(0),
			duplicates: z.int().min(0),
			noRate: z.int().min(0),
		}),
		unmatched: z.array(
			z.object({
				name: z.string(),
				rows: z.int().min(0),
				suggestionId: idSchema.nullable(),
			}),
		),
		currencies: z.array(currencyCodeSchema),
		currency: currencyCodeSchema.nullable(),
		warnings: z.array(z.string()),
	})
	.meta({ id: "ImportReview" });

export type ImportReviewDto = z.infer<typeof importReviewSchema>;

const rowChoiceSchema = z.object({
	index: z.int().min(0),
	keep: z.boolean(),
	categoryId: idSchema.nullable(),
	kind: z.enum(IMPORT_ROW_KINDS),
});

/**
 * What the review decides per row. Amounts, dates and currencies always
 * come from the stored file, never from the caller.
 */
export const finalizeImportSchema = importJobParamsSchema
	.extend({
		currency: currencyCodeSchema.nullish(),
		rows: z.array(rowChoiceSchema).max(5000),
	})
	.meta({ id: "FinalizeImport" });

export const importSummarySchema = z
	.object({
		jobId: idSchema,
		fileName: z.string(),
		fileRows: z.int().min(0),
		created: z.int().min(0),
		byKind: z.array(
			z.object({
				kind: z.enum(IMPORT_ROW_KINDS),
				count: z.int().min(0),
				/** The booked home values summed; null when none has one. */
				total: moneySchema.nullable(),
				withoutRate: z.int().min(0),
			}),
		),
		duplicates: z.int().min(0),
		unchecked: z.int().min(0),
		unreadable: z.int().min(0),
		noRate: z.int().min(0),
		from: daySchema.nullable(),
		to: daySchema.nullable(),
	})
	.meta({ id: "ImportSummary" });

export type ImportSummaryDto = z.infer<typeof importSummarySchema>;

export const undoImportResultSchema = z
	.object({ jobId: idSchema, removed: z.int().min(0) })
	.meta({ id: "UndoImportResult" });

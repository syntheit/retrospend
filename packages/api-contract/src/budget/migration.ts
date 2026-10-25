/** Migration notice, hidden rows, export and pacing. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import { isoDateSchema } from "./basics";

// ── Migration notice and hidden rows (SPEC §8.1, §8.3) ──────────────────────

export const migrationStateSchema = z.object({
	/** The book came from the old budget. */
	migrated: z.boolean(),
	/** "Your limits moved to the new budget. Nothing to set up." until dismissed. */
	noticeOpen: z.boolean(),
	/** Hidden expenses of the first month still to answer. */
	hiddenRows: z.number().int().min(0),
});

export const hiddenAnswerSchema = z.enum(["SPENDING", "NOT_SPENDING"]);

export const hiddenRowSchema = z.object({
	id: idSchema,
	title: z.string(),
	date: isoDateSchema,
	/** As entered, in its own currency. */
	amount: moneySchema,
	categoryId: idSchema.nullable(),
});

export const hiddenRowsOutputSchema = z.object({
	/** The book currency; null when there is nothing to review. */
	currency: z.string().nullable(),
	rows: z.array(hiddenRowSchema),
});

export const resolveHiddenInputSchema = z.object({
	answers: z
		.array(z.object({ id: idSchema, answer: hiddenAnswerSchema }))
		.min(1)
		.max(200),
});

export const resolveHiddenResultSchema = z.object({
	spending: z.array(idSchema),
	notSpending: z.array(idSchema),
});

/** The undo of an answer: the rows named go back to hidden. */
export const revertHiddenInputSchema = resolveHiddenResultSchema;

// ── Export (envelopes, movements, rules, months) ────────────────────────────

export const envelopeExportFileSchema = z.object({
	name: z.string(),
	contentType: z.enum(["text/csv", "application/json"]),
	content: z.string(),
});

export const envelopeExportSchema = z.object({
	files: z.array(envelopeExportFileSchema),
	/** The same files as one base64 ZIP for a Download button; null without a budget. */
	zipData: z.string().nullable(),
	filename: z.string(),
});

// ── Dashboard pacing from envelope totals ───────────────────────────────────

/**
 * What the dashboard's pace line reads once the budget is envelopes: money
 * available to spend this month (carried in plus assigned) against what has
 * been spent, in the book currency. Savings and goals are not spending.
 * Variable is everything outside the Bills group and bill envelopes.
 */
export const envelopePacingSchema = z.object({
	currency: z.string(),
	month: z.number().int(),
	total: z.object({ budget: moneySchema, spent: moneySchema }),
	variable: z.object({ budget: moneySchema, spent: moneySchema }),
	daysLeft: z.number().int().min(0),
	/** A rate is missing: the figures leave those rows out and say so. */
	incomplete: z.boolean(),
});

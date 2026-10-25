/**
 * Contract for the move from the old budget (budget build plan 02 §6, P7):
 * the notice a migrated person sees once, the hidden rows to review, the
 * envelope export and the pacing the dashboard reads. Same conventions as
 * envelope.ts: money is `{ minor, currency }`, dates YYYY-MM-DD.
 */
import { z } from "zod";
import { isoDateSchema, moneySchema } from "./envelope";

const idSchema = z.string().min(1).max(64);

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

export type MigrationState = z.infer<typeof migrationStateSchema>;
export type HiddenAnswer = z.infer<typeof hiddenAnswerSchema>;
export type HiddenRow = z.infer<typeof hiddenRowSchema>;
export type HiddenRowsOutput = z.infer<typeof hiddenRowsOutputSchema>;
export type ResolveHiddenInput = z.infer<typeof resolveHiddenInputSchema>;
export type ResolveHiddenResult = z.infer<typeof resolveHiddenResultSchema>;
export type RevertHiddenInput = z.infer<typeof revertHiddenInputSchema>;
export type EnvelopeExport = z.infer<typeof envelopeExportSchema>;
export type EnvelopePacing = z.infer<typeof envelopePacingSchema>;

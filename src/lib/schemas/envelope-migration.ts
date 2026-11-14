/**
 * Contract for the move from the old budget (budget build plan 02 §6, P7):
 * the notice a migrated person sees once, the hidden rows to review, the
 * envelope export and the pacing the dashboard reads. Same conventions as
 * envelope.ts: money is `{ minor, currency }`, dates YYYY-MM-DD.
 */
import {
	envelopeExportFileSchema,
	envelopeExportSchema,
	envelopePacingSchema,
	hiddenAnswerSchema,
	hiddenRowSchema,
	hiddenRowsOutputSchema,
	migrationStateSchema,
	resolveHiddenResultSchema,
} from "@retrospend/api-contract/budget";
import { z } from "zod";

export {
	envelopeExportFileSchema,
	envelopeExportSchema,
	envelopePacingSchema,
	hiddenAnswerSchema,
	hiddenRowSchema,
	hiddenRowsOutputSchema,
	migrationStateSchema,
	resolveHiddenResultSchema,
};

const idSchema = z.string().min(1).max(64);

// ── Migration notice and hidden rows (SPEC §8.1, §8.3) ──────────────────────

export const resolveHiddenInputSchema = z.object({
	answers: z
		.array(z.object({ id: idSchema, answer: hiddenAnswerSchema }))
		.min(1)
		.max(200),
});

/** The undo of an answer: the rows named go back to hidden. */
export const revertHiddenInputSchema = resolveHiddenResultSchema;

// ── Export (envelopes, movements, rules, months) ────────────────────────────

// ── Dashboard pacing from envelope totals ───────────────────────────────────

export type MigrationState = z.infer<typeof migrationStateSchema>;
export type HiddenAnswer = z.infer<typeof hiddenAnswerSchema>;
export type HiddenRow = z.infer<typeof hiddenRowSchema>;
export type HiddenRowsOutput = z.infer<typeof hiddenRowsOutputSchema>;
export type ResolveHiddenInput = z.infer<typeof resolveHiddenInputSchema>;
export type ResolveHiddenResult = z.infer<typeof resolveHiddenResultSchema>;
export type RevertHiddenInput = z.infer<typeof revertHiddenInputSchema>;
export type EnvelopeExport = z.infer<typeof envelopeExportSchema>;
export type EnvelopePacing = z.infer<typeof envelopePacingSchema>;

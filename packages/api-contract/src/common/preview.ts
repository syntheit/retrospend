import * as z from "zod";
import { figureIdSchema, figureLineSchema } from "./money";

/**
 * Preview twins (R30, IMPLEMENTATION §2.4). Every money write `POST /x`
 * has `POST /x/preview` taking the same input. The server runs the real
 * write in a transaction, diffs the figures it declares it can touch, rolls
 * back and returns the diff, so the preview equals the result by
 * construction. A money write returns an undo token.
 *
 * The shapes mirror FiguresDiff in src/server/services/preview/types.ts.
 */
export const PREVIEW_SUFFIX = "/preview";

/** Present and true for a total made by converting other currencies at reference rates: an estimate, shown with "≈". */
const approxField = z.literal(true).optional().meta({
	description:
		"True when this figure is a total converted into your home currency at reference rates, so its amounts are estimates (show them with ≈).",
});

/** One currency line of a figure that moved; a side is null when it has no amount in that currency. */
export const figureChangeSchema = z
	.object({
		id: figureIdSchema,
		currency: z.string(),
		before: figureLineSchema.nullable(),
		after: figureLineSchema.nullable(),
		/** after minus before, in `currency`; a diff never converts. */
		delta: figureLineSchema,
		/** Every line of the figure after the write ("USD 20 stays"). */
		figureAfter: z.array(figureLineSchema),
		approx: approxField,
	})
	.meta({ id: "FigureChange" });

export const figureUnchangedSchema = z
	.object({
		id: figureIdSchema,
		lines: z.array(figureLineSchema),
		approx: approxField,
	})
	.meta({ id: "FigureUnchanged" });

/** A figure that could not be read on a side (missing rate): neither changed nor unchanged. */
export const figureUnavailableSchema = z
	.object({
		id: figureIdSchema,
		before: z.array(figureLineSchema).nullable(),
		after: z.array(figureLineSchema).nullable(),
	})
	.meta({ id: "FigureUnavailable" });

/**
 * What the write would do beyond moving figures, for the writes that decide
 * something the figures cannot say: which debts a payment pays and cancels,
 * which payments Settle all would record. `kind` names the write
 * (`payment.record`, `payment.confirm`, `project.settleAll`); the rest of the
 * object is that write's own shape, documented on its route. Absent for
 * writes whose figures say it all.
 */
export const previewDetailSchema = z
	.looseObject({ kind: z.string() })
	.meta({ id: "PreviewDetail" });

export const previewResultSchema = z
	.object({
		changes: z.array(figureChangeSchema),
		unchanged: z.array(figureUnchangedSchema),
		unavailable: z.array(figureUnavailableSchema),
		detail: previewDetailSchema.optional(),
	})
	.meta({ id: "PreviewResult" });

export type PreviewResult = z.infer<typeof previewResultSchema>;

export const undoTokenSchema = z
	.string()
	.min(1)
	.meta({ id: "UndoToken", description: "Pass to the undo route to revert." });

export function previewPathOf(path: string): string {
	return `${path}${PREVIEW_SUFFIX}`;
}

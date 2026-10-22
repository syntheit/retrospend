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
	})
	.meta({ id: "FigureChange" });

export const figureUnchangedSchema = z
	.object({
		id: figureIdSchema,
		lines: z.array(figureLineSchema),
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

export const previewResultSchema = z
	.object({
		changes: z.array(figureChangeSchema),
		unchanged: z.array(figureUnchangedSchema),
		unavailable: z.array(figureUnavailableSchema),
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

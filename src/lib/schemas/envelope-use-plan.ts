/**
 * Contract for Use my plan on money already in the pool (SPEC §5.4, owner
 * N72): the same plan Add income ends with, run on what is Not planned yet,
 * with the rest choice (Leave it, Save it, Next month). Money is the Money
 * DTO in minor units; the server decides every line.
 */
import { z } from "zod";
import {
	fillLineSchema,
	minorSchema,
	moneySchema,
	restChoiceSchema,
} from "./envelope";

export const usePlanInputSchema = z.object({
	/** Client id of the batch: a retry returns the batch it wrote instead of planning again. */
	batchId: z.string().uuid(),
	/** Plan only this much, never more than Not planned yet holds; default: all of it. */
	amountMinor: minorSchema.refine((v) => v > 0, "must be above 0").optional(),
	rest: restChoiceSchema.default("LEAVE"),
});

export const usePlanResultSchema = z.object({
	/** The one batch every line was written in; undo takes it back. */
	batchId: z.string().nullable(),
	lines: z.array(fillLineSchema),
	/** What stays Not planned yet. */
	rest: moneySchema,
	/** Where the rest went (Leave it when it stayed or was not offered). */
	restChoice: restChoiceSchema,
	/** More was asked for than Not planned yet holds: this much was planned at most. */
	capped: z.object({ asked: moneySchema, held: moneySchema }).nullable(),
	/** A retry of a batch already written: its id only, the lines were listed the first time. */
	replayed: z.boolean(),
});

export type UsePlanInput = z.infer<typeof usePlanInputSchema>;
export type UsePlanResult = z.infer<typeof usePlanResultSchema>;

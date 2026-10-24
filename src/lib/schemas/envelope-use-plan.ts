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
	/** Plan only this much; default: all of Not planned yet. */
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
});

export type UsePlanInput = z.infer<typeof usePlanInputSchema>;
export type UsePlanResult = z.infer<typeof usePlanResultSchema>;

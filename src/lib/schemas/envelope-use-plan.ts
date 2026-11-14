/**
 * Contract for Use my plan on money already in the pool (SPEC §5.4, owner
 * N72): the same plan Add income ends with, run on what is Not planned yet,
 * with the rest choice (Leave it, Save it, Next month). Money is the Money
 * DTO in minor units; the server decides every line.
 */
import { usePlanResultSchema } from "@retrospend/api-contract/budget";
import { z } from "zod";
import { minorSchema, restChoiceSchema } from "./envelope";

export const usePlanInputSchema = z.object({
	/** Client id of the batch: a retry returns the batch it wrote instead of planning again. */
	batchId: z.string().uuid(),
	/** Plan only this much, never more than Not planned yet holds; default: all of it. */
	amountMinor: minorSchema.refine((v) => v > 0, "must be above 0").optional(),
	rest: restChoiceSchema.default("LEAVE"),
});

export { usePlanResultSchema };

export type UsePlanInput = z.infer<typeof usePlanInputSchema>;
export type UsePlanResult = z.infer<typeof usePlanResultSchema>;

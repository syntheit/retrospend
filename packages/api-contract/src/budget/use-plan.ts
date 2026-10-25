/** Use my plan on money already in the pool. Mirrors src/lib/schemas/envelope-use-plan.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { clientIdSchema, positiveAmount } from "./basics";
import { fillLineSchema, restChoiceSchema } from "./read";

export const usePlanInputSchema = z.object({
	/** Client id of the batch: a retry returns the batch it wrote instead of planning again. */
	batchId: clientIdSchema,
	/** Plan only this much, never more than Not planned yet holds; default: all of it. */
	amount: positiveAmount.optional(),
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

/**
 * Use my plan on money already in the pool, merged flat into the envelope
 * router (envelope.*): a preview and apply pair of one mutation (R30) whose
 * undo is envelope.undo on the batch. Thin: the contract is in
 * ~/lib/schemas/envelope-use-plan, the logic in the services.
 */
import { applyOutputSchema, previewOutputSchema } from "~/lib/schemas/envelope";
import {
	usePlanInputSchema,
	usePlanResultSchema,
} from "~/lib/schemas/envelope-use-plan";
import { usePlanMutation } from "~/server/services/envelope/use-plan.mutation";
import { apply, envelopeProcedure, preview } from "./envelope-procedure";

export const envelopeUsePlanProcedures = {
	usePlanPreview: envelopeProcedure
		.input(usePlanInputSchema)
		.output(previewOutputSchema(usePlanResultSchema))
		.mutation(preview(usePlanMutation)),
	usePlan: envelopeProcedure
		.input(usePlanInputSchema)
		.output(applyOutputSchema(usePlanResultSchema))
		.mutation(apply(usePlanMutation)),
};

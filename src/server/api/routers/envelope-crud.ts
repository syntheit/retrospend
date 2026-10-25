/**
 * Envelope procedures for editing the budget's envelopes (stream 2B; SPEC §3,
 * §5.4, §5.13, D65), merged flat into the envelope router (envelope.*). Thin:
 * contracts from ~/lib/schemas/envelope-crud, logic in the services. Every
 * edit is a preview and apply pair of one mutation (R30); its undo is
 * `undoChange` on the edit's id.
 */

import { applyOutputSchema, previewOutputSchema } from "~/lib/schemas/envelope";
import {
	affordInputSchema,
	affordResultSchema,
	archiveEnvelopeInputSchema,
	archiveEnvelopeResultSchema,
	confirmStartingMoneyInputSchema,
	confirmStartingMoneyResultSchema,
	createEnvelopeInputSchema,
	createEnvelopeResultSchema,
	mergeEnvelopesInputSchema,
	mergeEnvelopesResultSchema,
	setTargetInputSchema,
	setTargetResultSchema,
	undoChangeInputSchema,
	undoChangeResultSchema,
	unroutedSharesInputSchema,
	unroutedSharesOutputSchema,
	updateEnvelopeInputSchema,
	updateEnvelopeResultSchema,
} from "~/lib/schemas/envelope-crud";
import { getAfford } from "~/server/services/envelope/afford-read.service";
import {
	archiveEnvelopeMutation,
	confirmStartingMoneyMutation,
	createEnvelopeMutation,
	mergeEnvelopesMutation,
	setTargetMutation,
	undoChangeMutation,
	updateEnvelopeMutation,
} from "~/server/services/envelope/crud.mutation";
import { getUnroutedShares } from "~/server/services/envelope/unrouted-shares.service";
import { apply, envelopeProcedure, preview } from "./envelope-procedure";

export const envelopeCrudProcedures = {
	/** "Can I afford it?": one amount, one answer; writes nothing. Null without a budget. */
	afford: envelopeProcedure
		.input(affordInputSchema)
		.output(affordResultSchema.nullable())
		.query(({ ctx, input }) => getAfford(ctx.session.user.id, input)),

	/** Shares that found no category: in Everything else until you pick (D19). */
	unroutedShares: envelopeProcedure
		.input(unroutedSharesInputSchema)
		.output(unroutedSharesOutputSchema.nullable())
		.query(({ ctx, input }) => getUnroutedShares(ctx.session.user.id, input)),

	setTargetPreview: envelopeProcedure
		.input(setTargetInputSchema)
		.output(previewOutputSchema(setTargetResultSchema))
		.mutation(preview(setTargetMutation)),
	setTarget: envelopeProcedure
		.input(setTargetInputSchema)
		.output(applyOutputSchema(setTargetResultSchema))
		.mutation(apply(setTargetMutation)),

	createEnvelopePreview: envelopeProcedure
		.input(createEnvelopeInputSchema)
		.output(previewOutputSchema(createEnvelopeResultSchema))
		.mutation(preview(createEnvelopeMutation)),
	createEnvelope: envelopeProcedure
		.input(createEnvelopeInputSchema)
		.output(applyOutputSchema(createEnvelopeResultSchema))
		.mutation(apply(createEnvelopeMutation)),

	updateEnvelopePreview: envelopeProcedure
		.input(updateEnvelopeInputSchema)
		.output(previewOutputSchema(updateEnvelopeResultSchema))
		.mutation(preview(updateEnvelopeMutation)),
	updateEnvelope: envelopeProcedure
		.input(updateEnvelopeInputSchema)
		.output(applyOutputSchema(updateEnvelopeResultSchema))
		.mutation(apply(updateEnvelopeMutation)),

	mergeEnvelopesPreview: envelopeProcedure
		.input(mergeEnvelopesInputSchema)
		.output(previewOutputSchema(mergeEnvelopesResultSchema))
		.mutation(preview(mergeEnvelopesMutation)),
	mergeEnvelopes: envelopeProcedure
		.input(mergeEnvelopesInputSchema)
		.output(applyOutputSchema(mergeEnvelopesResultSchema))
		.mutation(apply(mergeEnvelopesMutation)),

	archiveEnvelopePreview: envelopeProcedure
		.input(archiveEnvelopeInputSchema)
		.output(previewOutputSchema(archiveEnvelopeResultSchema))
		.mutation(preview(archiveEnvelopeMutation)),
	archiveEnvelope: envelopeProcedure
		.input(archiveEnvelopeInputSchema)
		.output(applyOutputSchema(archiveEnvelopeResultSchema))
		.mutation(apply(archiveEnvelopeMutation)),

	confirmStartingMoneyPreview: envelopeProcedure
		.input(confirmStartingMoneyInputSchema)
		.output(previewOutputSchema(confirmStartingMoneyResultSchema))
		.mutation(preview(confirmStartingMoneyMutation)),
	confirmStartingMoney: envelopeProcedure
		.input(confirmStartingMoneyInputSchema)
		.output(applyOutputSchema(confirmStartingMoneyResultSchema))
		.mutation(apply(confirmStartingMoneyMutation)),

	/** The undo of any of the edits above, by the id it returned. */
	undoChangePreview: envelopeProcedure
		.input(undoChangeInputSchema)
		.output(previewOutputSchema(undoChangeResultSchema))
		.mutation(preview(undoChangeMutation)),
	undoChange: envelopeProcedure
		.input(undoChangeInputSchema)
		.output(applyOutputSchema(undoChangeResultSchema))
		.mutation(apply(undoChangeMutation)),
};

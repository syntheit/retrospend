/**
 * Envelope procedures for splits (P3) and month close (P4), merged flat
 * into the envelope router (envelope.*). Thin: contracts from
 * ~/lib/schemas/envelope, logic in the services; every money write is a
 * preview and apply pair of one mutation (R30) whose undo is listed in it.
 */
import { z } from "zod";
import {
	applyOutputSchema,
	batchInputSchema,
	carryOverspendInputSchema,
	forgiveInputSchema,
	forgiveResultSchema,
	monthSummaryInputSchema,
	owedSchema,
	previewOutputSchema,
	projectRoutingResultSchema,
	setProjectRoutingInputSchema,
	setShareCategoryInputSchema,
	shareCategoryResultSchema,
	unforgiveInputSchema,
} from "~/lib/schemas/envelope";
import { monthSummaryOutputSchema } from "~/lib/schemas/envelope-book";
import {
	carryOverspendMutation,
	fixNegativeMutation,
	resetEnvelopesMutation,
} from "~/server/services/envelope/close.mutation";
import {
	getMonthSummary,
	getOwed,
} from "~/server/services/envelope/read.service";
import {
	forgiveMutation,
	setProjectRoutingMutation,
	setShareCategoryMutation,
	unforgiveMutation,
} from "~/server/services/envelope/splits.mutation";
import {
	apply,
	envelopeProcedure,
	movementApply,
	movementPreview,
	preview,
} from "./envelope-procedure";

const unforgiveResult = z.object({ paymentId: z.string() });

export const envelopeMoneyProcedures = {
	/** Money owed per person and currency (SPEC §6.9); null without a budget. */
	owed: envelopeProcedure
		.output(owedSchema.nullable())
		.query(({ ctx }) => getOwed(ctx.session.user.id)),

	setShareCategoryPreview: envelopeProcedure
		.input(setShareCategoryInputSchema)
		.output(previewOutputSchema(shareCategoryResultSchema))
		.mutation(preview(setShareCategoryMutation)),
	setShareCategory: envelopeProcedure
		.input(setShareCategoryInputSchema)
		.output(applyOutputSchema(shareCategoryResultSchema))
		.mutation(apply(setShareCategoryMutation)),

	setProjectRoutingPreview: envelopeProcedure
		.input(setProjectRoutingInputSchema)
		.output(previewOutputSchema(projectRoutingResultSchema))
		.mutation(preview(setProjectRoutingMutation)),
	setProjectRouting: envelopeProcedure
		.input(setProjectRoutingInputSchema)
		.output(applyOutputSchema(projectRoutingResultSchema))
		.mutation(apply(setProjectRoutingMutation)),

	forgivePreview: envelopeProcedure
		.input(forgiveInputSchema)
		.output(previewOutputSchema(forgiveResultSchema))
		.mutation(preview(forgiveMutation)),
	forgive: envelopeProcedure
		.input(forgiveInputSchema)
		.output(applyOutputSchema(forgiveResultSchema))
		.mutation(apply(forgiveMutation)),
	unforgivePreview: envelopeProcedure
		.input(unforgiveInputSchema)
		.output(previewOutputSchema(unforgiveResult))
		.mutation(preview(unforgiveMutation)),
	unforgive: envelopeProcedure
		.input(unforgiveInputSchema)
		.output(applyOutputSchema(unforgiveResult))
		.mutation(apply(unforgiveMutation)),

	/** A closed month's summary (SPEC §6.6); null until it closes. */
	monthSummary: envelopeProcedure
		.input(monthSummaryInputSchema)
		.output(monthSummaryOutputSchema.nullable())
		.query(({ ctx, input }) =>
			getMonthSummary(ctx.session.user.id, input.month),
		),

	carryOverspendPreview: envelopeProcedure
		.input(carryOverspendInputSchema)
		.output(movementPreview)
		.mutation(preview(carryOverspendMutation)),
	carryOverspend: envelopeProcedure
		.input(carryOverspendInputSchema)
		.output(movementApply)
		.mutation(apply(carryOverspendMutation)),
	fixNegativePreview: envelopeProcedure
		.input(batchInputSchema)
		.output(movementPreview)
		.mutation(preview(fixNegativeMutation)),
	fixNegative: envelopeProcedure
		.input(batchInputSchema)
		.output(movementApply)
		.mutation(apply(fixNegativeMutation)),
	resetPreview: envelopeProcedure
		.input(batchInputSchema)
		.output(movementPreview)
		.mutation(preview(resetEnvelopesMutation)),
	reset: envelopeProcedure
		.input(batchInputSchema)
		.output(movementApply)
		.mutation(apply(resetEnvelopesMutation)),
};

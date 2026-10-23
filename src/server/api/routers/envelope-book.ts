/**
 * Envelope procedures for the P4 book (SPEC §4.4, §5.5, §5.6, §5.11),
 * merged flat into the envelope router (envelope.*). Thin: contracts from
 * ~/lib/schemas/envelope-book, logic in the services; every money write is a
 * preview and apply pair of one mutation (R30) whose undo is listed in it.
 */
import { applyOutputSchema, previewOutputSchema } from "~/lib/schemas/envelope";
import {
	acknowledgeMonthInputSchema,
	acknowledgeMonthResultSchema,
	adjustmentSchema,
	bankSideSchema,
	bookPeriodResultSchema,
	pauseResultSchema,
	reconcileInputSchema,
	removeAdjustmentInputSchema,
	revertLimitInputSchema,
	revertLimitResultSchema,
	revertStyleInputSchema,
	revertStyleResultSchema,
	setBookPeriodInputSchema,
	setLimitInputSchema,
	setLimitResultSchema,
	setStyleInputSchema,
	setStyleResultSchema,
	welcomeBackInputSchema,
	welcomeBackResultSchema,
	welcomeBackSchema,
} from "~/lib/schemas/envelope-book";
import {
	acknowledge,
	getBankCheck,
	getWelcomeBack,
	pause,
	resume,
} from "~/server/services/envelope/book-read.service";
import {
	reconcileMutation,
	removeAdjustmentMutation,
	revertLimitMutation,
	revertStyleMutation,
	setBookPeriodMutation,
	setLimitMutation,
	setStyleMutation,
	welcomeBackMutation,
} from "~/server/services/envelope/book.mutation";
import { apply, envelopeProcedure, preview } from "./envelope-procedure";

export const envelopeBookProcedures = {
	/** "Done" on a month summary: that revision is read (no money moves). */
	acknowledgeMonth: envelopeProcedure
		.input(acknowledgeMonthInputSchema)
		.output(acknowledgeMonthResultSchema)
		.mutation(({ ctx, input }) => acknowledge(ctx.session.user.id, input)),

	setLimitPreview: envelopeProcedure
		.input(setLimitInputSchema)
		.output(previewOutputSchema(setLimitResultSchema))
		.mutation(preview(setLimitMutation)),
	setLimit: envelopeProcedure
		.input(setLimitInputSchema)
		.output(applyOutputSchema(setLimitResultSchema))
		.mutation(apply(setLimitMutation)),

	revertLimitPreview: envelopeProcedure
		.input(revertLimitInputSchema)
		.output(previewOutputSchema(revertLimitResultSchema))
		.mutation(preview(revertLimitMutation)),
	revertLimit: envelopeProcedure
		.input(revertLimitInputSchema)
		.output(applyOutputSchema(revertLimitResultSchema))
		.mutation(apply(revertLimitMutation)),

	setStylePreview: envelopeProcedure
		.input(setStyleInputSchema)
		.output(previewOutputSchema(setStyleResultSchema))
		.mutation(preview(setStyleMutation)),
	setStyle: envelopeProcedure
		.input(setStyleInputSchema)
		.output(applyOutputSchema(setStyleResultSchema))
		.mutation(apply(setStyleMutation)),
	revertStylePreview: envelopeProcedure
		.input(revertStyleInputSchema)
		.output(previewOutputSchema(revertStyleResultSchema))
		.mutation(preview(revertStyleMutation)),
	revertStyle: envelopeProcedure
		.input(revertStyleInputSchema)
		.output(applyOutputSchema(revertStyleResultSchema))
		.mutation(apply(revertStyleMutation)),

	/** "Just track": the book is kept, Budget shows tracking (no money moves). */
	pause: envelopeProcedure
		.output(pauseResultSchema)
		.mutation(({ ctx }) => pause(ctx.session.user.id)),
	resume: envelopeProcedure
		.output(pauseResultSchema)
		.mutation(({ ctx }) => resume(ctx.session.user.id)),

	welcomeBackState: envelopeProcedure
		.output(welcomeBackSchema)
		.query(({ ctx }) => getWelcomeBack(ctx.session.user.id)),
	welcomeBackPreview: envelopeProcedure
		.input(welcomeBackInputSchema)
		.output(previewOutputSchema(welcomeBackResultSchema))
		.mutation(preview(welcomeBackMutation)),
	welcomeBack: envelopeProcedure
		.input(welcomeBackInputSchema)
		.output(applyOutputSchema(welcomeBackResultSchema))
		.mutation(apply(welcomeBackMutation)),

	/** "Does this match your bank?" (SPEC §5.11). */
	bankCheck: envelopeProcedure
		.output(bankSideSchema)
		.query(({ ctx }) => getBankCheck(ctx.session.user.id)),
	reconcilePreview: envelopeProcedure
		.input(reconcileInputSchema)
		.output(previewOutputSchema(adjustmentSchema))
		.mutation(preview(reconcileMutation)),
	reconcile: envelopeProcedure
		.input(reconcileInputSchema)
		.output(applyOutputSchema(adjustmentSchema))
		.mutation(apply(reconcileMutation)),
	removeAdjustmentPreview: envelopeProcedure
		.input(removeAdjustmentInputSchema)
		.output(previewOutputSchema(adjustmentSchema))
		.mutation(preview(removeAdjustmentMutation)),
	removeAdjustment: envelopeProcedure
		.input(removeAdjustmentInputSchema)
		.output(applyOutputSchema(adjustmentSchema))
		.mutation(apply(removeAdjustmentMutation)),

	setBookPeriodPreview: envelopeProcedure
		.input(setBookPeriodInputSchema)
		.output(previewOutputSchema(bookPeriodResultSchema))
		.mutation(preview(setBookPeriodMutation)),
	setBookPeriod: envelopeProcedure
		.input(setBookPeriodInputSchema)
		.output(applyOutputSchema(bookPeriodResultSchema))
		.mutation(apply(setBookPeriodMutation)),
};

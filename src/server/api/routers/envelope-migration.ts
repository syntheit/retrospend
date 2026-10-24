/**
 * Envelope procedures for the move from the old budget (P7), merged flat
 * into the envelope router: the one-time notice, the hidden-rows review (an
 * answer is a preview and apply pair with its undo, R30), the export and the
 * dashboard's pace. Thin: contracts in ~/lib/schemas/envelope-migration,
 * logic in the services.
 */
import { applyOutputSchema, previewOutputSchema } from "~/lib/schemas/envelope";
import {
	envelopeExportSchema,
	envelopePacingSchema,
	hiddenRowsOutputSchema,
	migrationStateSchema,
	resolveHiddenInputSchema,
	resolveHiddenResultSchema,
	revertHiddenInputSchema,
} from "~/lib/schemas/envelope-migration";
import {
	resolveHiddenMutation,
	revertHiddenMutation,
} from "~/server/services/envelope/migration.mutation";
import {
	dismissMigrationNotice,
	getEnvelopeExport,
	getHiddenRows,
	getMigrationState,
	getPacing,
} from "~/server/services/envelope/migration-read.service";
import { apply, envelopeProcedure, preview } from "./envelope-procedure";

export const envelopeMigrationProcedures = {
	migrationState: envelopeProcedure
		.output(migrationStateSchema)
		.query(({ ctx }) => getMigrationState(ctx.session.user.id)),

	/** "Got it" on "Your limits moved to the new budget" (no money moves). */
	dismissMigrationNotice: envelopeProcedure
		.output(migrationStateSchema)
		.mutation(({ ctx }) => dismissMigrationNotice(ctx.session.user.id)),

	hiddenRows: envelopeProcedure
		.output(hiddenRowsOutputSchema)
		.query(({ ctx }) => getHiddenRows(ctx.session.user.id)),

	resolveHiddenPreview: envelopeProcedure
		.input(resolveHiddenInputSchema)
		.output(previewOutputSchema(resolveHiddenResultSchema))
		.mutation(preview(resolveHiddenMutation)),
	resolveHidden: envelopeProcedure
		.input(resolveHiddenInputSchema)
		.output(applyOutputSchema(resolveHiddenResultSchema))
		.mutation(apply(resolveHiddenMutation)),

	revertHiddenPreview: envelopeProcedure
		.input(revertHiddenInputSchema)
		.output(previewOutputSchema(resolveHiddenResultSchema))
		.mutation(preview(revertHiddenMutation)),
	revertHidden: envelopeProcedure
		.input(revertHiddenInputSchema)
		.output(applyOutputSchema(resolveHiddenResultSchema))
		.mutation(apply(revertHiddenMutation)),

	/** Envelopes, movements, rules and months as files. */
	exportBudget: envelopeProcedure
		.output(envelopeExportSchema)
		.query(({ ctx }) =>
			getEnvelopeExport(ctx.session.user.id, ctx.timeZone ?? undefined),
		),

	/** The dashboard's pace line; null without a book. */
	pacing: envelopeProcedure
		.output(envelopePacingSchema.nullable())
		.query(({ ctx }) =>
			getPacing(ctx.session.user.id, new Date(), ctx.timeZone ?? null),
		),
};

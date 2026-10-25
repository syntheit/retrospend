/**
 * The envelope budget over tRPC (build plan 02 §5.2). Thin: every
 * procedure declares its contract from ~/lib/schemas/envelope and calls a
 * service. Money writes go through the preview runner, so `xPreview` is the
 * same write rolled back and `x` commits it (R30). Splits and month close
 * procedures live in envelope-money.ts and merge in flat.
 *
 * Behind `envelopeBudgetMode` (OFF by default): with the flag off every
 * procedure except `enabled` answers FORBIDDEN.
 */
import { z } from "zod";
import {
	applyOutputSchema,
	assignInputSchema,
	coverInputSchema,
	coverOverviewSchema,
	coverSourcesInputSchema,
	fillFromTargetsInputSchema,
	fillFromTargetsOutputSchema,
	getMonthOutputSchema,
	historyInputSchema,
	historyOutputSchema,
	leftToSpendSchema,
	monthInputSchema,
	moveInputSchema,
	previewOutputSchema,
	setupInputSchema,
	setupPresetInputSchema,
	setupPresetOutputSchema,
	setupResultSchema,
	undoInputSchema,
	verdictSchema,
} from "~/lib/schemas/envelope";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isFlagEnabled } from "~/server/flags";
import {
	assignEnvelopes,
	coverEnvelope,
	moveMoney,
	undoMovements,
} from "~/server/services/envelope/movement.mutation";
import {
	getCoverSources,
	getFillFromTargets,
	getHistory,
	getLeftToSpend,
	getMonth,
	getSetupPreset,
	getVerdict,
} from "~/server/services/envelope/read.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { envelopeBookProcedures } from "./envelope-book";
import { envelopeCrudProcedures } from "./envelope-crud";
import { envelopeDebtProcedures } from "./envelope-debt";
import { envelopeMigrationProcedures } from "./envelope-migration";
import { envelopeMoneyProcedures } from "./envelope-money";
import { envelopePlanProcedures } from "./envelope-plan";
import {
	apply,
	envelopeProcedure,
	movementApply,
	movementPreview,
	preview,
} from "./envelope-procedure";
import { envelopeUsePlanProcedures } from "./envelope-use-plan";

export const envelopeRouter = createTRPCRouter({
	enabled: protectedProcedure
		.output(z.boolean())
		.query(({ ctx }) => isFlagEnabled("envelopeBudget", ctx.session.user)),

	setupPreset: envelopeProcedure
		.input(setupPresetInputSchema)
		.output(setupPresetOutputSchema)
		.query(({ ctx, input }) =>
			getSetupPreset(ctx.session.user.id, input.style),
		),

	setupPreview: envelopeProcedure
		.input(setupInputSchema)
		.output(previewOutputSchema(setupResultSchema))
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).preview(setupEnvelopeBook, {
				...input,
				timeZone: ctx.timeZone ?? null,
			}),
		),

	setup: envelopeProcedure
		.input(setupInputSchema)
		.output(applyOutputSchema(setupResultSchema))
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).apply(setupEnvelopeBook, {
				...input,
				timeZone: ctx.timeZone ?? null,
			}),
		),

	/** Null: no budget yet ("Just track"). */
	getMonth: envelopeProcedure
		.input(monthInputSchema)
		.output(getMonthOutputSchema.nullable())
		.query(({ ctx, input }) =>
			getMonth(
				ctx.session.user.id,
				input.month,
				new Date(),
				ctx.timeZone ?? null,
			),
		),

	verdict: envelopeProcedure
		.input(monthInputSchema)
		.output(verdictSchema.nullable())
		.query(({ ctx, input }) => getVerdict(ctx.session.user.id, input.month)),

	leftToSpend: envelopeProcedure
		.input(monthInputSchema)
		.output(leftToSpendSchema.nullable())
		.query(({ ctx, input }) =>
			getLeftToSpend(ctx.session.user.id, input.month),
		),

	fillFromTargets: envelopeProcedure
		.input(fillFromTargetsInputSchema)
		.output(fillFromTargetsOutputSchema)
		.query(({ ctx, input }) =>
			getFillFromTargets(ctx.session.user.id, input.month, input.amountMinor),
		),

	coverSources: envelopeProcedure
		.input(coverSourcesInputSchema)
		.output(coverOverviewSchema)
		.query(({ ctx, input }) =>
			getCoverSources(ctx.session.user.id, input.envelopeId, input.month),
		),

	history: envelopeProcedure
		.input(historyInputSchema)
		.output(historyOutputSchema)
		.query(({ ctx, input }) => getHistory(ctx.session.user.id, input)),

	assignPreview: envelopeProcedure
		.input(assignInputSchema)
		.output(movementPreview)
		.mutation(preview(assignEnvelopes)),
	assign: envelopeProcedure
		.input(assignInputSchema)
		.output(movementApply)
		.mutation(apply(assignEnvelopes)),

	movePreview: envelopeProcedure
		.input(moveInputSchema)
		.output(movementPreview)
		.mutation(preview(moveMoney)),
	move: envelopeProcedure
		.input(moveInputSchema)
		.output(movementApply)
		.mutation(apply(moveMoney)),

	coverPreview: envelopeProcedure
		.input(coverInputSchema)
		.output(movementPreview)
		.mutation(preview(coverEnvelope)),
	cover: envelopeProcedure
		.input(coverInputSchema)
		.output(movementApply)
		.mutation(apply(coverEnvelope)),

	undoPreview: envelopeProcedure
		.input(undoInputSchema)
		.output(movementPreview)
		.mutation(preview(undoMovements)),
	undo: envelopeProcedure
		.input(undoInputSchema)
		.output(movementApply)
		.mutation(apply(undoMovements)),

	...envelopeMoneyProcedures,
	...envelopeBookProcedures,
	...envelopePlanProcedures,
	...envelopeCrudProcedures,
	...envelopeDebtProcedures,
	...envelopeUsePlanProcedures,
	...envelopeMigrationProcedures,
});

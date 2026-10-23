/**
 * The envelope budget over tRPC (build plan 02 §5.2, P2). Thin: every
 * procedure declares its contract from ~/lib/schemas/envelope and calls a
 * service. Money writes go through the preview runner, so `xPreview` is the
 * same write rolled back and `x` commits it (R30).
 *
 * Behind `envelopeBudgetMode` (OFF by default): with the flag off every
 * procedure except `enabled` answers FORBIDDEN.
 */
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { z } from "zod";
import {
	applyOutputSchema,
	assignInputSchema,
	coverInputSchema,
	coverSourceSchema,
	coverSourcesInputSchema,
	fillFromTargetsInputSchema,
	fillFromTargetsOutputSchema,
	forgiveInputSchema,
	forgiveResultSchema,
	getMonthOutputSchema,
	historyInputSchema,
	historyOutputSchema,
	leftToSpendSchema,
	monthInputSchema,
	moveInputSchema,
	movementResultSchema,
	owedSchema,
	previewOutputSchema,
	projectRoutingResultSchema,
	setProjectRoutingInputSchema,
	setShareCategoryInputSchema,
	setupInputSchema,
	setupPresetInputSchema,
	setupPresetOutputSchema,
	setupResultSchema,
	shareCategoryResultSchema,
	undoInputSchema,
	unforgiveInputSchema,
	verdictSchema,
} from "~/lib/schemas/envelope";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isFlagEnabled } from "~/server/flags";
import {
	EnvelopeError,
	type EnvelopeErrorCode,
} from "~/server/services/envelope/errors";
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
	getOwed,
	getSetupPreset,
	getVerdict,
} from "~/server/services/envelope/read.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import {
	forgiveMutation,
	setProjectRoutingMutation,
	setShareCategoryMutation,
	unforgiveMutation,
} from "~/server/services/envelope/splits.mutation";
import { forUser, type MoneyMutation } from "~/server/services/preview";

const CODES: Record<EnvelopeErrorCode, TRPC_ERROR_CODE_KEY> = {
	NO_BOOK: "NOT_FOUND",
	BOOK_EXISTS: "CONFLICT",
	MONTH_CLOSED: "BAD_REQUEST",
	OVER_CAP: "BAD_REQUEST",
	INVALID: "BAD_REQUEST",
	NOT_FOUND: "NOT_FOUND",
	ID_REUSED: "CONFLICT",
	ALREADY_UNDONE: "CONFLICT",
};

/** Signed in, flag on; domain errors leave as tRPC codes in one place. */
const envelopeProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	if (!(await isFlagEnabled("envelopeBudget", ctx.session.user)))
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "The new budget is not available yet",
		});
	const result = await next();
	if (!result.ok && result.error.cause instanceof EnvelopeError) {
		throw new TRPCError({
			code: CODES[result.error.cause.code],
			message: result.error.cause.message,
			cause: result.error.cause,
		});
	}
	return result;
});

const movementPreview = previewOutputSchema(movementResultSchema);
const movementApply = applyOutputSchema(movementResultSchema);

type Ctx = { ctx: { session: { user: { id: string } } } };

/** A money write rolled back (R30): what it would change. */
const preview =
	<I, V>(mutation: MoneyMutation<I, V>) =>
	({ ctx, input }: Ctx & { input: I }) =>
		forUser(ctx.session.user.id).preview(mutation, input);

/** The same write committed, with its undo token. */
const apply =
	<I, V>(mutation: MoneyMutation<I, V>) =>
	({ ctx, input }: Ctx & { input: I }) =>
		forUser(ctx.session.user.id).apply(mutation, input);

const unforgiveResult = z.object({ paymentId: z.string() });

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
		.query(({ ctx, input }) => getMonth(ctx.session.user.id, input.month)),

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
		.output(z.array(coverSourceSchema))
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
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).preview(assignEnvelopes, input),
		),

	assign: envelopeProcedure
		.input(assignInputSchema)
		.output(movementApply)
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).apply(assignEnvelopes, input),
		),

	movePreview: envelopeProcedure
		.input(moveInputSchema)
		.output(movementPreview)
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).preview(moveMoney, input),
		),

	move: envelopeProcedure
		.input(moveInputSchema)
		.output(movementApply)
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).apply(moveMoney, input),
		),

	coverPreview: envelopeProcedure
		.input(coverInputSchema)
		.output(movementPreview)
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).preview(coverEnvelope, input),
		),

	cover: envelopeProcedure
		.input(coverInputSchema)
		.output(movementApply)
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).apply(coverEnvelope, input),
		),

	undoPreview: envelopeProcedure
		.input(undoInputSchema)
		.output(movementPreview)
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).preview(undoMovements, input),
		),

	undo: envelopeProcedure
		.input(undoInputSchema)
		.output(movementApply)
		.mutation(({ ctx, input }) =>
			forUser(ctx.session.user.id).apply(undoMovements, input),
		),

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
});

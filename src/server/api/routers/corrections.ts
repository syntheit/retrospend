/**
 * Corrections, locks, Ask to fix and Forgive (2C.2, MONEY-MOVES 1.11, 1.12).
 * Thin: contracts in ~/lib/schemas/corrections, logic in
 * services/corrections. Every write is a `preview` and `save` pair of one
 * mutation (R30); a save returns the undo token listed in its mutation file.
 *
 *   corrections.correct.{preview,save}    correct a settled split
 *   corrections.undoCorrection.{preview,save}
 *   corrections.askToFix.{preview,save}   ask the creator to fix a split
 *   corrections.respondToFix.{preview,save}  accept or decline
 *   corrections.cancelFix.{preview,save}
 *   corrections.withdrawFix.{preview,save}   undo of askToFix
 *   corrections.restoreFix.{preview,save}    undo of respond and cancel
 *   corrections.fixRequests               the requests on a split (asker and asked only)
 *   corrections.lockStates                lock, reason and who may correct or ask
 *   corrections.forgive.*, corrections.unforgive.*  Forgive without the budget flag
 */

import { z } from "zod";
import {
	askToFixInputSchema,
	cancelFixInputSchema,
	correctInputSchema,
	fixRequestsInputSchema,
	respondToFixInputSchema,
	restoreFixInputSchema,
	undoCorrectionInputSchema,
} from "~/lib/schemas/corrections";
import {
	forgiveInputSchema,
	unforgiveInputSchema,
} from "~/lib/schemas/envelope";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	correctSplitMutation,
	undoCorrectionMutation,
} from "~/server/services/corrections/correct.mutation";
import {
	askToFixMutation,
	cancelFixMutation,
	respondToFixMutation,
	restoreFixMutation,
	withdrawFixMutation,
} from "~/server/services/corrections/fix-request.mutation";
import {
	fixRequestsOf,
	lockStatesOf,
} from "~/server/services/corrections/read";
import {
	forgiveMutation,
	unforgiveMutation,
} from "~/server/services/envelope/splits.mutation";
import { money } from "./money-pair";

const same = <T>(value: T) => value;

export const correctionsRouter = createTRPCRouter({
	correct: money(
		correctInputSchema,
		correctSplitMutation,
		(v, ctx, notify) => ({
			...v,
			timeZone: ctx.timeZone,
			notify,
		}),
	),
	undoCorrection: money(
		undoCorrectionInputSchema,
		undoCorrectionMutation,
		same,
	),

	askToFix: money(askToFixInputSchema, askToFixMutation, (v, _ctx, notify) => ({
		...v,
		notify,
	})),
	respondToFix: money(
		respondToFixInputSchema,
		respondToFixMutation,
		(v, _ctx, notify) => ({ ...v, notify }),
	),
	cancelFix: money(cancelFixInputSchema, cancelFixMutation, same),
	withdrawFix: money(cancelFixInputSchema, withdrawFixMutation, same),
	restoreFix: money(restoreFixInputSchema, restoreFixMutation, same),

	fixRequests: protectedProcedure
		.input(fixRequestsInputSchema)
		.query(({ ctx, input }) =>
			fixRequestsOf(ctx.session.user.id, input.transactionId),
		),
	lockStates: protectedProcedure
		.input(
			z.object({ transactionIds: z.array(z.string().min(1)).min(1).max(200) }),
		)
		.query(({ ctx, input }) =>
			lockStatesOf(ctx.session.user.id, input.transactionIds),
		),

	forgive: money(forgiveInputSchema, forgiveMutation, same),
	unforgive: money(unforgiveInputSchema, unforgiveMutation, same),
});

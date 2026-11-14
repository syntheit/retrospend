import { z } from "zod";
import {
	assertWritableParticipant,
	createTRPCRouter,
	guestOrProtectedProcedure,
} from "~/server/api/trpc";
import { removeSelfFromSplit } from "~/server/services/corrections/guards";
import {
	answerShareInputSchema,
	restoreAnswerInputSchema,
} from "~/server/services/shared-expenses/answer-input";
import {
	answerShareWebMutation,
	restoreAnswerWebMutation,
} from "~/server/services/shared-expenses/answer-share-web.mutation";
import { VerificationService } from "~/server/services/shared-expenses/verification.service";
import { money } from "./money-pair";

export const verificationRouter = createTRPCRouter({
	/**
	 * GET /api/verification/queue
	 *
	 * Returns all pending verification items for the current participant (user or guest),
	 * sorted by transaction date descending. Includes full transaction context so the
	 * frontend can render the queue without additional API calls.
	 *
	 * Also runs auto-accept cleanup for stale items (>7 days) before returning.
	 */
	queue: guestOrProtectedProcedure.query(async ({ ctx }) => {
		const actor = assertWritableParticipant(ctx.participant);
		const service = new VerificationService(ctx.db, actor);
		return await service.getQueue();
	}),

	/**
	 * GET /api/verification/outgoing
	 *
	 * Returns transactions created by the current user where other participants
	 * still have PENDING verification status, grouped by participant.
	 */
	outgoing: guestOrProtectedProcedure.query(async ({ ctx }) => {
		const actor = assertWritableParticipant(ctx.participant);
		const service = new VerificationService(ctx.db, actor);
		return await service.getOutgoingPending();
	}),

	/**
	 * POST /api/verification/bulk-accept
	 *
	 * Accepts multiple pending verifications in a single atomic transaction.
	 * Idempotent: already-accepted items are silently skipped.
	 * Returns { accepted: number }, the count of newly accepted items.
	 */
	bulkAccept: guestOrProtectedProcedure
		.input(z.object({ txnIds: z.array(z.string().min(1)).min(1).max(100) }))
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			const service = new VerificationService(ctx.db, actor);
			return await service.bulkAccept(input.txnIds);
		}),

	/**
	 * verification.answer.{preview,save}: accept or reject your own share. The
	 * preview is the save run and rolled back; a save returns the signed undo.
	 * Only users answer here (the mutation is user-only); guests have no
	 * answer screen on the web.
	 */
	answer: money(
		answerShareInputSchema,
		answerShareWebMutation,
		({ txnId, ...rest }) => ({ transactionId: txnId, ...rest }),
	),

	/** verification.restoreAnswer.{preview,save}: take an answer back with the token its save returned. */
	restoreAnswer: money(
		restoreAnswerInputSchema,
		restoreAnswerWebMutation,
		(value) => value,
	),

	/**
	 * POST /api/verification/:txnId/remove-self
	 *
	 * Removes the caller's OWN split from a shared transaction ("Remove me").
	 * Deletes only the caller's SplitParticipant row, never other participants'
	 * splits and never the transaction itself. Forbidden once the transaction is
	 * locked (settled). Remaining shares are left as-is by design.
	 */
	removeSelf: guestOrProtectedProcedure
		.input(
			z.object({
				txnId: z.string().min(1),
				// Set true to remove yourself even though your share is already
				// paid (the payer then owes that payment back to you).
				confirmBalanceChange: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			return await removeSelfFromSplit(
				ctx.db,
				actor,
				input.txnId,
				input.confirmBalanceChange ?? false,
			);
		}),
});

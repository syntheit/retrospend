import { z } from "zod";
import {
	assertWritableParticipant,
	createTRPCRouter,
	guestOrProtectedProcedure,
} from "~/server/api/trpc";
import { VerificationService } from "~/server/services/shared-expenses/verification.service";

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
	 * POST /api/verification/:txnId/accept
	 *
	 * Accepts the current participant's pending verification on a shared transaction.
	 * Idempotent: already-accepted items return 200 with current state.
	 * Returns the updated transaction with computed status and all participant statuses.
	 */
	accept: guestOrProtectedProcedure
		.input(z.object({ txnId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			const service = new VerificationService(ctx.db, actor);
			return await service.accept(input.txnId);
		}),

	/**
	 * POST /api/verification/bulk-accept
	 *
	 * Accepts multiple pending verifications in a single atomic transaction.
	 * Idempotent: already-accepted items are silently skipped.
	 * Returns { accepted: number } — the count of newly accepted items.
	 */
	bulkAccept: guestOrProtectedProcedure
		.input(z.object({ txnIds: z.array(z.string().min(1)).min(1).max(100) }))
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			const service = new VerificationService(ctx.db, actor);
			return await service.bulkAccept(input.txnIds);
		}),

	/**
	 * POST /api/verification/:txnId/reject
	 *
	 * Rejects the current participant's pending verification on a shared transaction.
	 * Accepts an optional reason string stored on the SplitParticipant record.
	 * Returns the updated transaction with a rejectionPendingNotification flag
	 * for the future notification system (Chunk 3D).
	 */
	reject: guestOrProtectedProcedure
		.input(
			z.object({
				txnId: z.string().min(1),
				reason: z.string().max(500).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			const service = new VerificationService(ctx.db, actor);
			return await service.reject(input.txnId, input.reason);
		}),
});

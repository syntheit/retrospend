import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient, SplitParticipant } from "~prisma";
import { logAudit } from "./audit-log";
import { effectOfRemovingShare } from "./balance-change";
import type { ParticipantRef } from "./types";

/**
 * The write of "Remove me", on the caller's transaction. It answers the rows it
 * removed, which is what taking it back needs.
 *
 * Remove the caller's own split from a shared transaction ("Remove me").
 *
 * YNAB-style: deletes ONLY the caller's own SplitParticipant row. Does not
 * delete other participants' splits and does not delete the transaction.
 * The remaining shares are intentionally left as-is — the unassigned amount
 * becomes the creator's "hole". Balances recompute from the surviving split
 * rows automatically (see shared-expenses/balance.ts), so no balance code
 * needs to change.
 *
 * Guards:
 * - Caller must actually be a participant on the transaction.
 * - Forbidden when the transaction is locked (settled).
 * - When the caller's share is already paid (settlements recorded against
 *   it) or offset by other expenses, removing it would leave the payer
 *   owing the caller. That needs `confirmBalanceChange`. Erasing a share
 *   the caller still owes is the point of "Remove me" and needs no
 *   confirmation.
 */
export async function removeSelfIn(
	tx: Prisma.TransactionClient,
	actor: ParticipantRef,
	txnId: string,
	confirmBalanceChange = false,
): Promise<{ success: true; removed: SplitParticipant[] }> {
	const txn = await tx.sharedTransaction.findUnique({
		where: { id: txnId },
		select: {
			id: true,
			isLocked: true,
			projectId: true,
			currency: true,
			paidByType: true,
			paidById: true,
			createdByType: true,
			createdById: true,
			splitParticipants: true,
		},
	});

	if (!txn) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Transaction not found or has been deleted",
		});
	}

	if (txn.isLocked) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "This expense is settled and can no longer be changed",
		});
	}

	// The creator can't remove just themselves — that would hide the
	// expense from their own view while leaving it live for everyone else
	// with them still the payer. They should delete it instead.
	if (
		txn.createdByType === actor.participantType &&
		txn.createdById === actor.participantId
	) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Delete the expense instead of removing yourself from it",
		});
	}

	const mySplits = txn.splitParticipants.filter(
		(p) =>
			p.participantType === actor.participantType &&
			p.participantId === actor.participantId,
	);

	if (mySplits.length === 0) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You are not a participant on this transaction",
		});
	}

	const iPaid =
		txn.paidByType === actor.participantType &&
		txn.paidById === actor.participantId;
	const myShare = mySplits.reduce(
		(sum, sp) => sum + Number(sp.shareAmount),
		0,
	);
	if (!confirmBalanceChange && !iPaid && myShare > 0) {
		const effect = await effectOfRemovingShare(
			tx as unknown as PrismaClient,
			{
				payer: {
					participantType: txn.paidByType,
					participantId: txn.paidById,
				},
				participant: actor,
				share: myShare,
				currency: txn.currency,
				projectId: txn.projectId,
			},
		);
		if (effect === "flips_balance") {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"Your share of this expense is already paid, so removing yourself would leave the payer owing you. Confirm to remove anyway.",
			});
		}
	}

	// Delete only the caller's own split row(s). Never touch others'.
	await tx.splitParticipant.deleteMany({
		where: { id: { in: mySplits.map((sp) => sp.id) } },
	});

	// Audit the removal. Reuses the existing PARTICIPANT_REMOVED action and
	// SPLIT_PARTICIPANT target type — no new enum value / migration needed.
	await logAudit(tx, {
		actor: actor,
		action: "PARTICIPANT_REMOVED",
		targetType: "SPLIT_PARTICIPANT",
		targetId: txnId,
		changes: {
			participantType: actor.participantType,
			participantId: actor.participantId,
			removedSplitIds: mySplits.map((sp) => sp.id),
			selfRemoved: true,
		},
		projectId: txn.projectId ?? undefined,
	});

	return { success: true as const, removed: mySplits };
}

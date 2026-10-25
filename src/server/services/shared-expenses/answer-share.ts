import { TRPCError } from "@trpc/server";
import type { Prisma, VerificationStatus } from "~prisma";
import { logAudit } from "./audit-log";
import type { ParticipantRef } from "./types";

export type ShareAnswer = "accept" | "reject";

/** The answering share as it stood before the write: what taking the answer back puts on it. */
export interface ShareBefore {
	readonly id: string;
	readonly verificationStatus: VerificationStatus;
	readonly verifiedAt: Date | null;
	readonly rejectionReason: string | null;
}

const ACCEPTED: VerificationStatus[] = ["ACCEPTED", "AUTO_ACCEPTED"];

/**
 * Answers your own share of a split expense, on the caller's transaction:
 * accept, or reject with an optional reason. Answering the same way twice
 * changes nothing (`changed` false). The web's VerificationService.accept and
 * .reject and the v1 money mutation (answer-share.mutation.ts) run this one
 * function, so they cannot differ.
 */
export async function answerShareIn(
	tx: Prisma.TransactionClient,
	actor: ParticipantRef,
	txnId: string,
	answer: ShareAnswer,
	reason?: string,
) {
	const txn = await tx.sharedTransaction.findUnique({
		where: { id: txnId },
		include: { splitParticipants: true },
	});
	if (!txn) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Transaction not found or has been deleted",
		});
	}
	const mine = txn.splitParticipants.filter(
		(p) =>
			p.participantType === actor.participantType &&
			p.participantId === actor.participantId,
	);
	if (mine.length === 0) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You are not a participant on this transaction",
		});
	}
	if (mine.length > 1) {
		// Defensive: the unique constraint should prevent this.
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Duplicate participant records detected; please contact support",
		});
	}
	const sp = mine[0]!;
	const before: ShareBefore = {
		id: sp.id,
		verificationStatus: sp.verificationStatus,
		verifiedAt: sp.verifiedAt,
		rejectionReason: sp.rejectionReason,
	};
	const already =
		answer === "accept"
			? ACCEPTED.includes(sp.verificationStatus)
			: sp.verificationStatus === "REJECTED";
	if (already) return { txn, before, changed: false };

	await tx.splitParticipant.update({
		where: { id: sp.id },
		data:
			answer === "accept"
				? { verificationStatus: "ACCEPTED", verifiedAt: new Date() }
				: {
						verificationStatus: "REJECTED",
						verifiedAt: new Date(),
						rejectionReason: reason ?? null,
					},
	});
	await logAudit(tx, {
		actor,
		action: answer === "accept" ? "VERIFIED" : "REJECTED",
		targetType: "SHARED_TRANSACTION",
		targetId: txnId,
		changes: {
			participantId: sp.id,
			participantType: sp.participantType,
			participantRef: sp.participantId,
			...(answer === "reject" ? { reason: reason ?? null } : {}),
		},
		projectId: txn.projectId ?? undefined,
	});
	const updated = await tx.sharedTransaction.findUniqueOrThrow({
		where: { id: txnId },
		include: { splitParticipants: true },
	});
	return { txn: updated, before, changed: true };
}

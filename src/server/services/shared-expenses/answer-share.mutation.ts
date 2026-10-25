/**
 * Accept or reject your share of a split expense as a money mutation (R30,
 * R15): the call previews as the same write rolled back, and its undo puts the
 * share back as it was while it still reads the answer. The web's own calls
 * (VerificationService.accept and .reject) run the same answerShareIn.
 */
import { TRPCError } from "@trpc/server";
import { SHARED_FIGURES } from "~/server/services/entry/shared.mutation";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { VerificationStatus } from "~prisma";
import { answerShareIn, type ShareAnswer } from "./answer-share";
import { logAudit } from "./audit-log";

export interface AnswerShareInput {
	readonly transactionId: string;
	readonly answer: ShareAnswer;
	readonly reason?: string;
}

/** The share before the answer, as a token carries it: JSON, so no Date. */
export interface ShareWas {
	readonly splitId: string;
	readonly verificationStatus: VerificationStatus;
	readonly verifiedAt: string | null;
	readonly rejectionReason: string | null;
}

export interface ShareAnswered {
	readonly transactionId: string;
	readonly answer: ShareAnswer;
	/** False when the share already read this answer: nothing was written. */
	readonly changed: boolean;
	readonly was: ShareWas;
	readonly status: "pending" | "disputed" | "active";
	readonly participants: readonly {
		readonly type: "user" | "guest" | "shadow";
		readonly id: string;
		readonly status: VerificationStatus;
	}[];
}

function statusOf(
	participants: { verificationStatus: VerificationStatus }[],
): ShareAnswered["status"] {
	if (participants.some((p) => p.verificationStatus === "REJECTED"))
		return "disputed";
	if (participants.some((p) => p.verificationStatus === "PENDING"))
		return "pending";
	return "active";
}

export const answerShareMutation: MoneyMutation<
	AnswerShareInput,
	ShareAnswered
> = {
	id: "sharedExpense.answerShare",
	touches: SHARED_FIGURES,
	run: async (tx, input, actor) => {
		const { txn, before, changed } = await answerShareIn(
			tx,
			{ participantType: "user", participantId: actor.userId },
			input.transactionId,
			input.answer,
			input.reason,
		);
		return {
			value: {
				transactionId: input.transactionId,
				answer: input.answer,
				changed,
				was: {
					splitId: before.id,
					verificationStatus: before.verificationStatus,
					verifiedAt: before.verifiedAt?.toISOString() ?? null,
					rejectionReason: before.rejectionReason,
				},
				status: statusOf(txn.splitParticipants),
				participants: txn.splitParticipants.map((p) => ({
					type: p.participantType as "user" | "guest" | "shadow",
					id: p.participantId,
					status: p.verificationStatus,
				})),
			},
			undo: {
				kind: "revert",
				mutation: "sharedExpense.restoreAnswer",
				rows: [{ table: "split_participant", id: before.id }],
			},
		};
	},
};

export interface RestoreAnswerInput {
	readonly transactionId: string;
	readonly answer: ShareAnswer;
	readonly was: ShareWas;
}

/**
 * Undo of answerShare: the share goes back to what it was, only while it
 * still reads the answer and the expense is not settled.
 */
export const restoreAnswerMutation: MoneyMutation<
	RestoreAnswerInput,
	{ readonly transactionId: string }
> = {
	id: "sharedExpense.restoreAnswer",
	touches: SHARED_FIGURES,
	run: async (tx, input, actor) => {
		const split = await tx.splitParticipant.findFirst({
			where: {
				id: input.was.splitId,
				transactionId: input.transactionId,
				participantType: "user",
				participantId: actor.userId,
			},
			include: { transaction: { select: { isLocked: true, projectId: true } } },
		});
		if (!split)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Transaction not found or has been deleted",
			});
		const reads =
			input.answer === "accept"
				? split.verificationStatus === "ACCEPTED"
				: split.verificationStatus === "REJECTED";
		if (!reads || split.transaction.isLocked)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Your share changed since. Undo is no longer safe.",
			});
		await tx.splitParticipant.update({
			where: { id: split.id },
			data: {
				verificationStatus: input.was.verificationStatus,
				verifiedAt: input.was.verifiedAt ? new Date(input.was.verifiedAt) : null,
				rejectionReason: input.was.rejectionReason,
			},
		});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: actor.userId },
			action: "EDITED",
			targetType: "SHARED_TRANSACTION",
			targetId: input.transactionId,
			changes: {
				participantId: split.id,
				answerTakenBack: input.answer,
				restoredStatus: input.was.verificationStatus,
			},
			projectId: split.transaction.projectId ?? undefined,
		});
		return {
			value: { transactionId: input.transactionId },
			undo: {
				kind: "revert",
				mutation: "sharedExpense.answerShare",
				rows: [{ table: "split_participant", id: split.id }],
			},
		};
	},
};

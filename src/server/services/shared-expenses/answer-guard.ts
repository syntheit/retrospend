/**
 * What stops you answering your own share. A rejected share is not owed, so a
 * reject or accept that changes the answer changes balances; these three
 * states refuse it, each with a code of its own (API v1 problem codes, and
 * the web reads the same code), and each points to Ask to fix, which asks the
 * creator to change the expense instead:
 *
 * - share_locked: the expense is settled, so no answer can change.
 * - share_is_correction: a correction, or an expense that has corrections,
 *   is undone rather than rejected (as Remove me, remove-self.ts).
 * - share_reject_reverses_payment: your share is already paid, and rejecting
 *   it would turn that payment into a debt the other way round (as Remove me
 *   without confirmBalanceChange, balance-change.ts).
 *
 * answerShareIn and restoreAnswerMutation both call this, so taking an answer
 * back or doing it again is refused the same way.
 */
import { shareCounts } from "@retrospend/domain/share-status";
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient, VerificationStatus } from "~prisma";
import { effectOfRemovingShare } from "./balance-change";
import { type ParticipantRef, sameParticipant } from "./types";

export type ShareRefusal =
	| "share_locked"
	| "share_is_correction"
	| "share_reject_reverses_payment";

/** A refused answer: a CONFLICT on the web, its own problem code in API v1. */
export class ShareAnswerRefusedError extends TRPCError {
	readonly problem: ShareRefusal;

	constructor(problem: ShareRefusal, message: string) {
		super({ code: "CONFLICT", message });
		this.name = "ShareAnswerRefusedError";
		this.problem = problem;
	}
}

export interface AnsweredExpense {
	id: string;
	isLocked: boolean;
	correctsId: string | null;
	projectId: string | null;
	currency: string;
	paidByType: string;
	paidById: string;
}

/**
 * Throws a {@link ShareAnswerRefusedError} when `actor`'s share, as it reads
 * now (`share`), may not take the answer `next`. Call it only for a change:
 * answering the way the share already reads is not one.
 */
export async function assertAnswerAllowed(
	tx: Prisma.TransactionClient,
	args: {
		expense: AnsweredExpense;
		actor: ParticipantRef;
		share: {
			verificationStatus: VerificationStatus;
			shareAmount: Prisma.Decimal;
		};
		next: VerificationStatus;
	},
): Promise<void> {
	const { expense, actor, share, next } = args;
	if (expense.isLocked)
		throw new ShareAnswerRefusedError(
			"share_locked",
			"This expense is settled, so your answer can no longer change. Ask to fix it instead.",
		);
	// Only a reject changes what is owed; accepting a share that waits does not.
	if (shareCounts(next) || !shareCounts(share.verificationStatus)) return;

	const corrections = await tx.sharedTransaction.count({
		where: { correctsId: expense.id },
	});
	if (expense.correctsId || corrections > 0)
		throw new ShareAnswerRefusedError(
			"share_is_correction",
			"A correction cannot be rejected. Ask to fix it instead.",
		);

	// The payer's own share is not a debt, so it has no payment to reverse.
	const payer: ParticipantRef = {
		participantType: expense.paidByType as ParticipantRef["participantType"],
		participantId: expense.paidById,
	};
	if (sameParticipant(payer, actor)) return;
	const effect = await effectOfRemovingShare(tx as unknown as PrismaClient, {
		payer,
		participant: actor,
		share: share.shareAmount,
		currency: expense.currency,
		projectId: expense.projectId,
	});
	if (effect === "flips_balance")
		throw new ShareAnswerRefusedError(
			"share_reject_reverses_payment",
			"Your share is already paid, so rejecting it would leave the payer owing you. Ask to fix it instead.",
		);
}

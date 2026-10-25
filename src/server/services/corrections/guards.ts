/**
 * Guards for the rows corrections add to a split (MONEY-MOVES 1.11).
 *
 * A correction row is the difference from the split it corrects, and a split
 * with corrections is the base they add to. Taking a person off either one
 * would make debt vanish, so the participant-changing writes refuse both and
 * point to undoing the correction.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "~prisma";
import type { ParticipantRef } from "../shared-expenses/types";
import { VerificationService } from "../shared-expenses/verification.service";

/** Refuses a correction row and a split that has corrections. */
export async function assertNoCorrections(
	db: PrismaClient | Prisma.TransactionClient,
	transactionId: string,
): Promise<void> {
	const row = await (db as PrismaClient).sharedTransaction.findUnique({
		where: { id: transactionId },
		select: { correctsId: true, _count: { select: { corrections: true } } },
	});
	if (row && (row.correctsId || row._count.corrections > 0)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "This expense has a correction and can no longer be changed",
		});
	}
}

/** "Remove me" from a split, unless it is a correction or has corrections. */
export async function removeSelfFromSplit(
	db: PrismaClient,
	actor: ParticipantRef,
	transactionId: string,
	confirmBalanceChange: boolean,
) {
	await assertNoCorrections(db, transactionId);
	return new VerificationService(db, actor).removeSelf(
		transactionId,
		confirmBalanceChange,
	);
}

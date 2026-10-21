import type { Prisma } from "~prisma";

type ParticipantType = "user" | "guest" | "shadow";

interface SplitOwner {
	participantType: ParticipantType;
	participantId: string;
}

/**
 * Steps 1 and 2 of the 3-step merge that moves one participant's split rows
 * onto another without breaking @@unique([transactionId, participantType,
 * participantId]):
 *
 * 1. Where the target already has a row on the same expense, add the source
 *    row's share into it. shareAmount, sharePercentage and shareUnits are all
 *    summed, so a PERCENTAGE or SHARES expense keeps a percentage/units value
 *    that matches the merged amount (a later rescale or edit recomputes from
 *    those, and a stale value would silently undo the merge). A column that
 *    is null on both rows stays null.
 * 2. Delete the source rows that were merged.
 *
 * Step 3 (re-pointing the remaining source rows with updateMany) is left to
 * the caller, since the shape of that update differs per call site.
 */
export async function mergeOverlappingSplitRows(
	tx: Pick<Prisma.TransactionClient, "$executeRaw">,
	source: SplitOwner,
	target: SplitOwner,
): Promise<void> {
	await tx.$executeRaw`
		UPDATE split_participant AS target
		SET    "shareAmount"     = target."shareAmount" + source."shareAmount",
		       "sharePercentage" = CASE
		           WHEN target."sharePercentage" IS NULL AND source."sharePercentage" IS NULL THEN NULL
		           ELSE COALESCE(target."sharePercentage", 0) + COALESCE(source."sharePercentage", 0)
		       END,
		       "shareUnits"      = CASE
		           WHEN target."shareUnits" IS NULL AND source."shareUnits" IS NULL THEN NULL
		           ELSE COALESCE(target."shareUnits", 0) + COALESCE(source."shareUnits", 0)
		       END
		FROM   split_participant AS source
		WHERE  source."participantType" = ${source.participantType}::"ParticipantType"
		  AND  source."participantId"   = ${source.participantId}
		  AND  target."transactionId"   = source."transactionId"
		  AND  target."participantType" = ${target.participantType}::"ParticipantType"
		  AND  target."participantId"   = ${target.participantId}
	`;
	await tx.$executeRaw`
		DELETE FROM split_participant
		WHERE  "participantType" = ${source.participantType}::"ParticipantType"
		  AND  "participantId"   = ${source.participantId}
		  AND  "transactionId" IN (
			SELECT "transactionId"
			FROM   split_participant
			WHERE  "participantType" = ${target.participantType}::"ParticipantType"
			  AND  "participantId"   = ${target.participantId}
		  )
	`;
}

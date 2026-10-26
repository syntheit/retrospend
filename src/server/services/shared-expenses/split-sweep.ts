import type { Prisma } from "~prisma";
import { logAuditMany } from "./audit-log";
import type { ParticipantRef } from "./types";

// Convention for system-generated audit entries. Uses "user" type with a
// sentinel ID. Since all real IDs are CUID-generated (alphanumeric), the
// "__system__" prefix is guaranteed to never collide.
const SYSTEM_ACTOR: ParticipantRef = {
	participantType: "user",
	participantId: "__system__",
};

export interface ExpiredSplit {
	id: string;
	participantType: string;
	participantId: string;
	transaction: { projectId: string | null };
}

/**
 * Marks the splits auto-accepted and records each one (AUTO_VERIFIED). Run it
 * in one transaction: the accept and its record stand or fall together. The
 * system actor's entries are not readable by the user, so they are written
 * without a read-back (logAuditMany).
 */
export async function autoAcceptSplits(
	tx: Prisma.TransactionClient,
	expired: readonly ExpiredSplit[],
	days: number,
	now: Date,
): Promise<void> {
	await tx.splitParticipant.updateMany({
		where: { id: { in: expired.map((sp) => sp.id) } },
		data: { verificationStatus: "AUTO_ACCEPTED", verifiedAt: now },
	});
	await logAuditMany(
		tx,
		expired.map((sp) => ({
			actor: SYSTEM_ACTOR,
			action: "AUTO_VERIFIED" as const,
			targetType: "SPLIT_PARTICIPANT" as const,
			targetId: sp.id,
			changes: {
				participantType: sp.participantType,
				participantId: sp.participantId,
				autoAcceptedAfterDays: days,
			},
			projectId: sp.transaction.projectId ?? undefined,
		})),
	);
}

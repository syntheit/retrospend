/**
 * What deleting an account does to the ghosts (shadow profiles) its user made.
 * A ghost in a project that goes on is given to that project's heir, so the
 * balances between the remaining members and the ghost do not change. A ghost
 * with no such project is detached from the shared records under its own
 * sentinel (never a shared one, so one ghost's debt cannot cancel another's
 * credit) before the cascade deletes it.
 */
import { repointSettlementParty } from "./payments/participants";
import { mergeOverlappingSplitRows } from "./shared-expenses/split-merge";
import { deletedShadowSentinel } from "./deleted-sentinels";
import { findSuccessorOrganizer } from "./user-deletion-projects";
import type { PrismaClient } from "~prisma";

// Transaction client type - same capabilities as PrismaClient minus lifecycle methods
export type PrismaTx = Omit<
	PrismaClient,
	"$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Anonymizes all shared-expense references for a participant, replacing their ID
 * with a sentinel value. Handles the split_participant unique constraint by merging
 * share amounts when a sentinel row already exists for the same transaction.
 *
 * Must be called within a transaction. Does NOT delete the participant entity itself.
 */
export async function anonymizeParticipantReferences(
	tx: PrismaTx,
	participantType: "guest" | "shadow",
	participantId: string,
	sentinelId: string,
): Promise<void> {
	// Merge split_participant shares where sentinel already exists (unique
	// constraint), then delete the merged rows (now duplicates)
	await mergeOverlappingSplitRows(
		tx,
		{ participantType, participantId },
		{ participantType, participantId: sentinelId },
	);
	// Update remaining split_participant rows
	await tx.splitParticipant.updateMany({
		where: { participantType, participantId },
		data: { participantId: sentinelId },
	});

	// Anonymize SharedTransaction paidBy/createdBy
	await tx.sharedTransaction.updateMany({
		where: { paidByType: participantType, paidById: participantId },
		data: { paidById: sentinelId },
	});
	await tx.sharedTransaction.updateMany({
		where: { createdByType: participantType, createdById: participantId },
		data: { createdById: sentinelId },
	});

	// Anonymize Settlement from/to and payment headers
	await repointSettlementParty(tx, { participantType, participantId }, { participantType, participantId: sentinelId });

	// Anonymize AuditLogEntry actor
	await tx.auditLogEntry.updateMany({
		where: { actorType: participantType, actorId: participantId },
		data: { actorId: sentinelId },
	});

	// Remove ProjectParticipant records
	await tx.projectParticipant.deleteMany({
		where: { participantType, participantId },
	});
}


const ANY_ROLE = ["ORGANIZER", "EDITOR", "CONTRIBUTOR", "VIEWER"] as const;

/** Gives each ghost of `userId` to the heir of a project it is in, or detaches it. */
export async function retireGhosts(
	tx: PrismaTx,
	userId: string,
): Promise<void> {
	const owned = await tx.shadowProfile.findMany({
		where: { createdById: userId },
		select: { id: true },
	});
	for (const { id } of owned) {
		const memberships = await tx.projectParticipant.findMany({
			where: { participantType: "shadow", participantId: id },
			orderBy: { joinedAt: "asc" },
			select: { projectId: true },
		});
		let heirId: string | null = null;
		for (const { projectId } of memberships) {
			const heir = await findSuccessorOrganizer(tx, projectId, userId, ANY_ROLE);
			if (heir) {
				heirId = heir.participantId;
				break;
			}
		}
		if (heirId) {
			await tx.shadowProfile.update({
				where: { id },
				data: { createdById: heirId },
			});
		} else {
			await anonymizeParticipantReferences(
				tx,
				"shadow",
				id,
				deletedShadowSentinel(id),
			);
		}
	}
}

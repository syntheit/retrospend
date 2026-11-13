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

	// Anonymize fix requests the participant sent or was asked
	await tx.fixRequest.updateMany({
		where: { requestedByType: participantType, requestedById: participantId },
		data: { requestedById: sentinelId },
	});
	await tx.fixRequest.updateMany({
		where: { askedType: participantType, askedId: participantId },
		data: { askedId: sentinelId },
	});

	// Remove ProjectParticipant records
	await tx.projectParticipant.deleteMany({
		where: { participantType, participantId },
	});
}


const ANY_ROLE = ["ORGANIZER", "EDITOR", "CONTRIBUTOR", "VIEWER"] as const;

/** A sealed cell starts with U+0001; a person's own text never can (field-crypto.ts). */
const SEALED = "\u0001";

/**
 * Nulls the ghost's email and phone when they are sealed. They are the
 * creator's sealed text and unreadable once that user's key is shredded, and
 * the heir's key cannot open them (key ids are small integers, so a cell of
 * another owner would fail its tag as if it were corrupt). `emailHash` stays,
 * so the ghost still auto-claims by address. A cell that is still plaintext
 * (saved before sealing) is left as it is: nothing to repair, and no rewrite
 * beyond what sealing needs. Raw SQL on purpose: a model write would seal or
 * open the cells.
 */
async function clearSealedContact(tx: PrismaTx, id: string): Promise<void> {
	await tx.$executeRaw`
		UPDATE "shadow_profile" SET
			"email" = CASE WHEN starts_with("email", ${SEALED}) THEN NULL ELSE "email" END,
			"phone" = CASE WHEN starts_with("phone", ${SEALED}) THEN NULL ELSE "phone" END
		WHERE "id" = ${id}`;
}

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
			// Before the owner changes: the deleting user still owns the row (RLS).
			await clearSealedContact(tx, id);
			await tx.shadowProfile.update({
				where: { id },
				select: { id: true },
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

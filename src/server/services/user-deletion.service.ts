import type { PrismaClient } from "~prisma";
import { assertAnotherAdminRemains } from "./admin-guard.service";
import { DELETED_USER_SENTINEL } from "./deleted-sentinels";
import { keptUndoFiles } from "./entry/undo-stash";
import { findGuestSessionsByEmail } from "./guest-session-lookup";
import { destroyDataKeysIfStored } from "./keys/data-key.service";
import {
	repointSettlementParty,
	syncPaymentHeaders,
} from "./payments/participants";
import { mergeOverlappingSplitRows } from "./shared-expenses/split-merge";
import { type PrismaTx, retireGhosts } from "./user-deletion-ghosts";
import {
	countOtherUserOrganizers,
	findSuccessorOrganizer,
	handOverCreatedProjects,
	PENDING_SETTLEMENT_SELECT,
} from "./user-deletion-projects";
import { removeUserFiles } from "./user-files.service";

export * from "./deleted-sentinels";
export { anonymizeParticipantReferences } from "./user-deletion-ghosts";
export { type DeletionPreview, previewAccountDeletion } from "./user-deletion-preview";

// ── Pre-deletion cleanup ──────────────────────────────────────────────────────

/**
 * Resolves all functional dependencies for the user BEFORE anonymization.
 * Runs inside the anonymizeAndDeleteUser transaction.
 *
 * Step 1: Projects where user is sole organizer → promote or delete
 * Step 2: Pending settlements → auto-confirm or cancel
 * Step 3: Pending verifications → auto-accept
 */
async function preDeletionCleanup(tx: PrismaTx, userId: string): Promise<void> {
	// ── Step 1: Projects where user is the only organizer ────────────────────

	const userOrganizerRoles = await tx.projectParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			role: "ORGANIZER",
		},
		select: { projectId: true },
	});

	for (const pp of userOrganizerRoles) {
		// If another organizer already exists, no action needed
		if ((await countOtherUserOrganizers(tx, pp.projectId, userId)) > 0)
			continue;

		const promotee = await findSuccessorOrganizer(tx, pp.projectId, userId);

		if (!promotee) {
			// No other registered user - delete the project entirely
			await tx.project.delete({ where: { id: pp.projectId }, select: { id: true } });
		} else {
			// Promote to organizer
			await tx.projectParticipant.update({
				where: { id: promotee.id }, select: { id: true },
				data: { role: "ORGANIZER" },
			});

			await tx.auditLogEntry.create({
				select: { id: true }, data: {
					actorType: "user",
					actorId: userId,
					action: "ROLE_CHANGED",
					targetType: "PROJECT",
					targetId: pp.projectId,
					projectId: pp.projectId,
					changes: {
						message:
							"System promoted participant to Owner because the previous owner deleted their account.",
						promotedParticipantId: promotee.participantId,
						promotedParticipantType: promotee.participantType,
						newRole: "ORGANIZER",
					},
				},
			});
		}
	}

	// ── Step 2: Auto-resolve pending settlements ──────────────────────────────
	// Only PROPOSED settlements are pending. A REJECTED one was refused by the
	// payee and must stay refused: finalizing it would wipe a debt the payee
	// said was never paid. It is left as is and anonymized with the rest.

	// User as payer (fromParticipant)
	const settlementsAsPayer = await tx.settlement.findMany({
		where: {
			fromParticipantType: "user",
			fromParticipantId: userId,
			status: "PROPOSED",
		},
		select: PENDING_SETTLEMENT_SELECT,
	});

	// A pending row has exactly one side agreed: the person who recorded it.
	// That is the payer for a payment, but an offset row of a payment group
	// points the other way (see settlement-groups.ts), so check "one side
	// agreed" rather than "the payer agreed". Every row of a pending group then
	// gets the same outcome and the group is never split.
	for (const s of settlementsAsPayer) {
		if (s.confirmedByPayer !== s.confirmedByPayee) {
			// The payment was recorded - finalize to benefit the other party
			await tx.settlement.update({
				where: { id: s.id }, select: { id: true },
				data: {
					confirmedByPayer: true,
					confirmedByPayee: true,
					status: "FINALIZED",
					settledAt: new Date(),
				},
			});
			await tx.auditLogEntry.create({
				select: { id: true }, data: {
					actorType: "user",
					actorId: userId,
					action: "SETTLED",
					targetType: "SETTLEMENT",
					targetId: s.id,
					changes: {
						message:
							"Settlement auto-confirmed: payer deleted their account. Settlement marked as complete.",
						autoConfirmedField: "confirmedByPayee",
					},
				},
			});
		} else {
			// Payer never confirmed - cancel the proposal
			await tx.auditLogEntry.create({
				select: { id: true }, data: {
					actorType: "user",
					actorId: userId,
					action: "DELETED",
					targetType: "SETTLEMENT",
					targetId: s.id,
					changes: {
						message: "Settlement cancelled: participant deleted their account.",
					},
				},
			});
			await tx.settlement.delete({ where: { id: s.id }, select: { id: true } });
		}
	}

	// User as payee (toParticipant)
	const settlementsAsPayee = await tx.settlement.findMany({
		where: {
			toParticipantType: "user",
			toParticipantId: userId,
			status: "PROPOSED",
		},
		select: PENDING_SETTLEMENT_SELECT,
	});

	for (const s of settlementsAsPayee) {
		if (s.confirmedByPayer !== s.confirmedByPayee) {
			// One side recorded it - auto-confirm the rest since user is leaving
			await tx.settlement.update({
				where: { id: s.id }, select: { id: true },
				data: {
					confirmedByPayer: true,
					confirmedByPayee: true,
					status: "FINALIZED",
					settledAt: new Date(),
				},
			});
			await tx.auditLogEntry.create({
				select: { id: true }, data: {
					actorType: "user",
					actorId: userId,
					action: "SETTLED",
					targetType: "SETTLEMENT",
					targetId: s.id,
					changes: {
						message:
							"Settlement auto-confirmed: payee deleted their account. Settlement marked as complete.",
						autoConfirmedField: "confirmedByPayee",
					},
				},
			});
		} else {
			// Neither confirmed - cancel
			await tx.auditLogEntry.create({
				select: { id: true }, data: {
					actorType: "user",
					actorId: userId,
					action: "DELETED",
					targetType: "SETTLEMENT",
					targetId: s.id,
					changes: {
						message: "Settlement cancelled: participant deleted their account.",
					},
				},
			});
			await tx.settlement.delete({ where: { id: s.id }, select: { id: true } });
		}
	}

	// Headers take their rows' new status; one whose rows were all cancelled goes.
	await syncPaymentHeaders(
		tx,
		[...settlementsAsPayer, ...settlementsAsPayee].map((s) => s.paymentGroupId),
	);

	// ── Step 3: Auto-accept pending verifications ─────────────────────────────

	await tx.splitParticipant.updateMany({
		where: {
			participantType: "user",
			participantId: userId,
			verificationStatus: "PENDING",
		},
		data: {
			verificationStatus: "AUTO_ACCEPTED",
			verifiedAt: new Date(),
		},
	});
}

// ── Main deletion function ────────────────────────────────────────────────────

/**
 * Anonymizes all shared-expense records that reference the user, then deletes
 * the user record (which cascades all personal data).
 *
 * Must be called with the global (superuser) db - not a user-scoped client.
 * Avatar cleanup happens outside the transaction since it's idempotent;
 * a failure leaves an orphaned file but does not block deletion.
 */
export async function anonymizeAndDeleteUser(
	db: PrismaClient,
	userId: string,
	userEmail: string,
	avatarPath: string | null,
): Promise<void> {
	// Feedback rows go with the user; their screenshots are files, so the
	// paths are read first and the files removed after the commit.
	let screenshotPaths: string[] = [];
	let iconPaths: string[] = [];
	// Before the transaction (it cannot load keys); none, not a failure, on a lost key.
	const guestIds = (await findGuestSessionsByEmail(db, userEmail, { skipIfKeyLost: true })).map((g) => g.id);
	await db.$transaction(async (tx) => {
		await assertAnotherAdminRemains(tx, userId);
		screenshotPaths = (
			await tx.feedback.findMany({
				where: { userId, screenshotPath: { not: null } },
				select: { screenshotPath: true },
			})
		).flatMap((f) => (f.screenshotPath ? [f.screenshotPath] : []));
		// Uploaded account pictures, live and held in an undo stash.
		const [accounts, stashes] = await Promise.all([
			tx.assetAccount.findMany({
				where: { userId, iconKind: "IMAGE" },
				select: { iconValue: true },
			}),
			keptUndoFiles(tx, { userId }),
		]);
		iconPaths = [...accounts.map((a) => a.iconValue), ...stashes].filter(
			(p): p is string => !!p,
		);
		// ── Pre-deletion cleanup: resolve functional dependencies ─────────────
		await preDeletionCleanup(tx as unknown as PrismaTx, userId);

		await handOverCreatedProjects(tx as unknown as PrismaTx, userId);

		// ── Anonymize shared expense records ──────────────────────────────────

		// Anonymize SharedTransaction paidBy
		await tx.sharedTransaction.updateMany({
			where: { paidByType: "user", paidById: userId },
			data: { paidById: DELETED_USER_SENTINEL },
		});

		// Anonymize SharedTransaction createdBy
		await tx.sharedTransaction.updateMany({
			where: { createdByType: "user", createdById: userId },
			data: { createdById: DELETED_USER_SENTINEL },
		});

		// Anonymize SplitParticipant
		//
		// Because of @@unique([transactionId, participantType, participantId]), a
		// plain updateMany would fail with a unique-constraint violation if a
		// DELETED_USER row already exists for the same transaction (i.e. a previous
		// user already deleted their account and was in the same split).
		//
		// Strategy:
		//   1. Merge the share into the pre-existing DELETED_USER row.
		//   2. Delete the user's row that was just merged (it would conflict).
		//   3. Update the remaining user rows where no conflict exists.
		await mergeOverlappingSplitRows(
			tx,
			{ participantType: "user", participantId: userId },
			{ participantType: "user", participantId: DELETED_USER_SENTINEL },
		);
		await tx.splitParticipant.updateMany({
			where: { participantType: "user", participantId: userId },
			data: { participantId: DELETED_USER_SENTINEL },
		});

		// Anonymize Settlement from/to and payment headers
		await repointSettlementParty(
			tx,
			{ participantType: "user", participantId: userId },
			{ participantType: "user", participantId: DELETED_USER_SENTINEL },
		);

		// Anonymize ProjectParticipant
		//
		// Same unique-constraint issue: @@unique([projectId, participantType, participantId]).
		// If DELETED_USER is already a participant in the same project (prior deletion),
		// delete the conflicting row first, then update the rest.
		await tx.$executeRaw`
			DELETE FROM project_participant
			WHERE  "participantType" = 'user'
			  AND  "participantId"   = ${userId}
			  AND  "projectId" IN (
				SELECT "projectId"
				FROM   project_participant
				WHERE  "participantType" = 'user'
				  AND  "participantId"   = ${DELETED_USER_SENTINEL}
			  )
		`;
		await tx.projectParticipant.updateMany({
			where: { participantType: "user", participantId: userId },
			data: { participantId: DELETED_USER_SENTINEL },
		});

		// Anonymize AuditLogEntry actor
		await tx.auditLogEntry.updateMany({
			where: { actorType: "user", actorId: userId },
			data: { actorId: DELETED_USER_SENTINEL },
		});

		// TODO: AuditLogEntry.changes may hold this userId in field diffs (low risk).

		// Ghosts this user created: the ones in a project that goes on belong to its
		// heir, the rest are detached before the cascade deletes them.
		await retireGhosts(tx as unknown as PrismaTx, userId);

		// Delete the user - cascades all personal data (expenses, budgets, sessions, etc.)
		await tx.user.delete({ where: { id: userId }, select: { id: true } });

		// Crypto-shred after the user row, in this transaction (race and trigger
		// notes on destroyDataKeys in data-key.service.ts).
		await destroyDataKeysIfStored(userId, tx);

		// Clean up GuestSessions that used this user's email (pre-signup guest access)
		await tx.guestSession.deleteMany({ where: { id: { in: guestIds } } });
	});
	// Only once the guard passed and the delete committed; a failure leaves a file behind
	await removeUserFiles(userId, avatarPath, screenshotPaths, iconPaths);
}

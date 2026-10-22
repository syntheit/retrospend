import type { PrismaClient } from "~prisma";
import { deleteFile } from "~/server/storage";
import { repointPaymentParty, syncPaymentHeaders } from "./payments/participants";
import { mergeOverlappingSplitRows } from "./shared-expenses/split-merge";

export const DELETED_USER_SENTINEL = "DELETED_USER";
export const DELETED_USER_NAME = "Deleted User";

export const DELETED_GUEST_SENTINEL = "DELETED_GUEST";
export const DELETED_GUEST_NAME = "Deleted Guest";

export const DELETED_SHADOW_SENTINEL = "DELETED_SHADOW";
export const DELETED_SHADOW_NAME = "Deleted Participant";

// Transaction client type - same capabilities as PrismaClient minus lifecycle methods
type PrismaTx = Omit<
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

	// Anonymize Settlement from/to
	await tx.settlement.updateMany({
		where: { fromParticipantType: participantType, fromParticipantId: participantId },
		data: { fromParticipantId: sentinelId },
	});
	await tx.settlement.updateMany({
		where: { toParticipantType: participantType, toParticipantId: participantId },
		data: { toParticipantId: sentinelId },
	});
	await repointPaymentParty(
		tx,
		{ participantType, participantId },
		{ participantType, participantId: sentinelId },
	);

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

// ── Preview types ─────────────────────────────────────────────────────────────

export interface DeletionPreview {
	projectsToTransfer: { id: string; name: string; newOrganizerName: string }[];
	projectsToDelete: { id: string; name: string }[];
	settlementsToAutoConfirm: number;
	settlementsToCancel: number;
	verificationsToAutoAccept: number;
	sharedTransactionsToAnonymize: number;
}

/**
 * Resolves a display name for a participant without throwing on missing records.
 */
async function resolveParticipantDisplayName(
	db: PrismaClient | PrismaTx,
	participantType: string,
	participantId: string,
): Promise<string> {
	if (participantId === DELETED_USER_SENTINEL) return DELETED_USER_NAME;

	if (participantType === "user") {
		const user = await (db as PrismaClient).user.findUnique({
			where: { id: participantId },
			select: { name: true },
		});
		return user?.name ?? "another member";
	}

	if (participantType === "shadow") {
		const shadow = await (db as PrismaClient).shadowProfile.findUnique({
			where: { id: participantId },
			select: { name: true },
		});
		return shadow?.name ?? "another member";
	}

	return "another member";
}

/**
 * Picks who takes over a project whose only organizer is deleting their
 * account: the longest-standing registered user, preferring EDITOR, then
 * CONTRIBUTOR, then VIEWER. Ghosts (shadows) and guests are never promoted:
 * neither can sign in, so an ORGANIZER ghost would leave the project with no
 * one able to run it. Returns null when no other registered user is a member.
 */
async function findSuccessorOrganizer(
	db: PrismaClient | PrismaTx,
	projectId: string,
	userId: string,
) {
	for (const role of ["EDITOR", "CONTRIBUTOR", "VIEWER"] as const) {
		const candidate = await (db as PrismaClient).projectParticipant.findFirst({
			where: {
				projectId,
				participantType: "user",
				participantId: { not: userId },
				role,
			},
			orderBy: { joinedAt: "asc" },
		});
		if (candidate) return candidate;
	}
	return null;
}

/**
 * Counts the project's other registered-user organizers. A non-user
 * ORGANIZER row (which should not exist) does not count: it cannot run the
 * project.
 */
async function countOtherUserOrganizers(
	db: PrismaClient | PrismaTx,
	projectId: string,
	userId: string,
): Promise<number> {
	return (db as PrismaClient).projectParticipant.count({
		where: {
			projectId,
			participantType: "user",
			participantId: { not: userId },
			role: "ORGANIZER",
		},
	});
}

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
		where: { participantType: "user", participantId: userId, role: "ORGANIZER" },
		include: { project: { select: { id: true, name: true } } },
	});

	for (const pp of userOrganizerRoles) {
		// If another organizer already exists, no action needed
		if ((await countOtherUserOrganizers(tx, pp.projectId, userId)) > 0) continue;

		const promotee = await findSuccessorOrganizer(tx, pp.projectId, userId);

		if (!promotee) {
			// No other registered user - delete the project entirely
			await tx.project.delete({ where: { id: pp.projectId } });
		} else {
			// Promote to organizer
			await tx.projectParticipant.update({
				where: { id: promotee.id },
				data: { role: "ORGANIZER" },
			});

			await tx.auditLogEntry.create({
				data: {
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
				where: { id: s.id },
				data: {
					confirmedByPayer: true,
					confirmedByPayee: true,
					status: "FINALIZED",
					settledAt: new Date(),
				},
			});
			await tx.auditLogEntry.create({
				data: {
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
				data: {
					actorType: "user",
					actorId: userId,
					action: "DELETED",
					targetType: "SETTLEMENT",
					targetId: s.id,
					changes: {
						message:
							"Settlement cancelled: participant deleted their account.",
					},
				},
			});
			await tx.settlement.delete({ where: { id: s.id } });
		}
	}

	// User as payee (toParticipant)
	const settlementsAsPayee = await tx.settlement.findMany({
		where: {
			toParticipantType: "user",
			toParticipantId: userId,
			status: "PROPOSED",
		},
	});

	for (const s of settlementsAsPayee) {
		if (s.confirmedByPayer !== s.confirmedByPayee) {
			// One side recorded it - auto-confirm the rest since user is leaving
			await tx.settlement.update({
				where: { id: s.id },
				data: {
					confirmedByPayer: true,
					confirmedByPayee: true,
					status: "FINALIZED",
					settledAt: new Date(),
				},
			});
			await tx.auditLogEntry.create({
				data: {
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
				data: {
					actorType: "user",
					actorId: userId,
					action: "DELETED",
					targetType: "SETTLEMENT",
					targetId: s.id,
					changes: {
						message:
							"Settlement cancelled: participant deleted their account.",
					},
				},
			});
			await tx.settlement.delete({ where: { id: s.id } });
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

// ── Preview (read-only) ───────────────────────────────────────────────────────

/**
 * Computes what WOULD happen if the user deleted their account, without
 * modifying anything. Used to show the pre-deletion summary in the UI.
 */
export async function previewAccountDeletion(
	db: PrismaClient,
	userId: string,
): Promise<DeletionPreview> {
	const projectsToTransfer: DeletionPreview["projectsToTransfer"] = [];
	const projectsToDelete: DeletionPreview["projectsToDelete"] = [];

	// Step 1: Projects where user is the only organizer
	const userOrganizerRoles = await db.projectParticipant.findMany({
		where: { participantType: "user", participantId: userId, role: "ORGANIZER" },
		include: { project: { select: { id: true, name: true } } },
	});

	for (const pp of userOrganizerRoles) {
		if ((await countOtherUserOrganizers(db, pp.projectId, userId)) > 0) continue;

		const promotee = await findSuccessorOrganizer(db, pp.projectId, userId);

		if (!promotee) {
			projectsToDelete.push({ id: pp.projectId, name: pp.project.name });
		} else {
			const newOrganizerName = await resolveParticipantDisplayName(
				db,
				promotee.participantType,
				promotee.participantId,
			);
			projectsToTransfer.push({
				id: pp.projectId,
				name: pp.project.name,
				newOrganizerName,
			});
		}
	}

	// Step 2: Pending settlements
	const [settlementsAsPayer, settlementsAsPayee] = await Promise.all([
		db.settlement.findMany({
			where: {
				fromParticipantType: "user",
				fromParticipantId: userId,
				status: "PROPOSED",
			},
			select: { id: true, confirmedByPayer: true, confirmedByPayee: true },
		}),
		db.settlement.findMany({
			where: {
				toParticipantType: "user",
				toParticipantId: userId,
				status: "PROPOSED",
			},
			select: { id: true, confirmedByPayer: true, confirmedByPayee: true },
		}),
	]);

	let settlementsToAutoConfirm = 0;
	let settlementsToCancel = 0;

	// Same rule as preDeletionCleanup: one side agreed => auto-confirm.
	for (const s of settlementsAsPayer) {
		if (s.confirmedByPayer !== s.confirmedByPayee) settlementsToAutoConfirm++;
		else settlementsToCancel++;
	}
	for (const s of settlementsAsPayee) {
		if (s.confirmedByPayer !== s.confirmedByPayee) settlementsToAutoConfirm++;
		else settlementsToCancel++;
	}

	// Step 3: Pending verifications
	const verificationsToAutoAccept = await db.splitParticipant.count({
		where: {
			participantType: "user",
			participantId: userId,
			verificationStatus: "PENDING",
		},
	});

	// Shared transactions that will be anonymized
	const sharedTransactionsToAnonymize = await db.sharedTransaction.count({
		where: {
			OR: [
				{ paidByType: "user", paidById: userId },
				{ createdByType: "user", createdById: userId },
			],
		},
	});

	return {
		projectsToTransfer,
		projectsToDelete,
		settlementsToAutoConfirm,
		settlementsToCancel,
		verificationsToAutoAccept,
		sharedTransactionsToAnonymize,
	};
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
	// Clean up avatar from storage before the transaction
	if (avatarPath) {
		await deleteFile(avatarPath).catch(() => {});
	}

	await db.$transaction(async (tx) => {
		// ── Pre-deletion cleanup: resolve functional dependencies ─────────────
		await preDeletionCleanup(tx as unknown as PrismaTx, userId);

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

		// Anonymize Settlement fromParticipant
		await tx.settlement.updateMany({
			where: { fromParticipantType: "user", fromParticipantId: userId },
			data: { fromParticipantId: DELETED_USER_SENTINEL },
		});

		// Anonymize Settlement toParticipant
		await tx.settlement.updateMany({
			where: { toParticipantType: "user", toParticipantId: userId },
			data: { toParticipantId: DELETED_USER_SENTINEL },
		});
		await repointPaymentParty(
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

		// TODO: Sanitize userId from AuditLogEntry.changes JSON fields.
		// The changes field stores structural field diffs (old/new values), not
		// user IDs as first-class values, so the risk is low. If needed, a raw
		// UPDATE ... SET changes = replace(changes::text, userId, DELETED_USER_SENTINEL)::jsonb
		// query can be added here.

		// Ghosts this user created are cascade-deleted with the user. Detach them
		// from shared records first (same as an admin deleting a ghost), so no
		// project membership, split or settlement is left pointing at a shadow
		// row that no longer exists.
		const ownedShadows = await tx.shadowProfile.findMany({
			where: { createdById: userId },
			select: { id: true },
		});
		for (const shadow of ownedShadows) {
			await anonymizeParticipantReferences(
				tx as unknown as PrismaTx,
				"shadow",
				shadow.id,
				DELETED_SHADOW_SENTINEL,
			);
		}

		// Delete the user - cascades all personal data (expenses, budgets, sessions, etc.)
		await tx.user.delete({ where: { id: userId } });

		// Clean up GuestSessions that used this user's email (pre-signup guest access)
		await tx.guestSession.deleteMany({ where: { email: userEmail } });
	});
}

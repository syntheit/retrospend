import type { Prisma, PrismaClient } from "~prisma";

interface MigrationResult {
	migratedSessionCount: number;
	claimedShadowCount: number;
	projectIds: string[];
}

/**
 * Migrate all guest sessions matching `userEmail` to the newly-created user.
 *
 * For each GuestSession:
 *   1. ProjectParticipant  - change guest to user (merge if user already in project)
 *   2. SharedTransaction   - update paidBy / createdBy refs
 *   3. SplitParticipant    - update with unique-constraint merge pattern
 *   4. Settlement          - update from/to participant refs
 *   5. AuditLogEntry       - update actor refs
 *   6. Delete GuestSession
 *
 * Also claims unclaimed ShadowProfile records with matching email.
 *
 * All wrapped in a single $transaction for atomicity.
 */
export async function migrateGuestSessionsToUser(
	db: PrismaClient,
	userId: string,
	userEmail: string,
): Promise<MigrationResult> {
	const guestSessions = await db.guestSession.findMany({
		where: { email: userEmail.toLowerCase() },
	});

	if (guestSessions.length === 0) {
		// Still try to claim shadow profiles even without guest sessions
		const claimedShadowCount = await claimShadowProfiles(db, userId, userEmail);
		return { migratedSessionCount: 0, claimedShadowCount, projectIds: [] };
	}

	const projectIds: string[] = [];

	await db.$transaction(async (tx) => {
		for (const session of guestSessions) {
			const guestId = session.id;

			// ─── 1. ProjectParticipant: guest → user ───────────────────────
			await migrateProjectParticipants(tx, guestId, userId, session.projectId, projectIds);

			// ─── 2. SharedTransaction: paidBy ──────────────────────────────
			await tx.sharedTransaction.updateMany({
				where: { paidByType: "guest", paidById: guestId },
				data: { paidByType: "user", paidById: userId },
			});

			// ─── 3. SharedTransaction: createdBy ───────────────────────────
			await tx.sharedTransaction.updateMany({
				where: { createdByType: "guest", createdById: guestId },
				data: { createdByType: "user", createdById: userId },
			});

			// ─── 4. SplitParticipant (unique constraint merge pattern) ─────
			await migrateSplitParticipants(tx, guestId, userId);

			// ─── 5. Settlement: fromParticipant ────────────────────────────
			await tx.settlement.updateMany({
				where: { fromParticipantType: "guest", fromParticipantId: guestId },
				data: { fromParticipantType: "user", fromParticipantId: userId },
			});

			// ─── 6. Settlement: toParticipant ──────────────────────────────
			await tx.settlement.updateMany({
				where: { toParticipantType: "guest", toParticipantId: guestId },
				data: { toParticipantType: "user", toParticipantId: userId },
			});

			// ─── 7. AuditLogEntry: actor ───────────────────────────────────
			await tx.auditLogEntry.updateMany({
				where: { actorType: "guest", actorId: guestId },
				data: { actorType: "user", actorId: userId },
			});

			// ─── 8. Delete GuestSession ────────────────────────────────────
			await tx.guestSession.delete({ where: { id: guestId } });
		}
	});

	// Claim shadow profiles outside the main transaction (non-critical)
	const claimedShadowCount = await claimShadowProfiles(db, userId, userEmail);

	return {
		migratedSessionCount: guestSessions.length,
		claimedShadowCount,
		projectIds: [...new Set(projectIds)],
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function migrateProjectParticipants(
	tx: Prisma.TransactionClient,
	guestId: string,
	userId: string,
	projectId: string,
	projectIds: string[],
) {
	// Check if the user already has a participant record in this project
	const existingUserParticipant = await tx.projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: {
				projectId,
				participantType: "user",
				participantId: userId,
			},
		},
	});

	const guestParticipant = await tx.projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: {
				projectId,
				participantType: "guest",
				participantId: guestId,
			},
		},
	});

	if (!guestParticipant) return;

	projectIds.push(projectId);

	if (existingUserParticipant) {
		// User already in project - keep higher-privilege role, delete guest record
		const ROLE_PRIORITY: Record<string, number> = {
			ORGANIZER: 3,
			CONTRIBUTOR: 2,
			VIEWER: 1,
		};
		const guestPriority = ROLE_PRIORITY[guestParticipant.role] ?? 0;
		const userPriority = ROLE_PRIORITY[existingUserParticipant.role] ?? 0;

		if (guestPriority > userPriority) {
			await tx.projectParticipant.update({
				where: { id: existingUserParticipant.id },
				data: { role: guestParticipant.role },
			});
		}

		// Delete the guest participant record (user record already exists)
		await tx.projectParticipant.delete({
			where: { id: guestParticipant.id },
		});
	} else {
		// Convert guest → user
		await tx.projectParticipant.update({
			where: { id: guestParticipant.id },
			data: { participantType: "user", participantId: userId },
		});
	}
}

async function migrateSplitParticipants(
	tx: Prisma.TransactionClient,
	guestId: string,
	userId: string,
) {
	// Three-step merge pattern to handle @@unique([transactionId, participantType, participantId])
	//
	// If the user already has a split entry for the same transaction (e.g. they were
	// added as a user participant before registering as a guest), we merge amounts.

	// Step 1: Merge shareAmount into pre-existing user row
	await tx.$executeRaw`
		UPDATE split_participant AS target
		SET    "shareAmount" = target."shareAmount" + source."shareAmount"
		FROM   split_participant AS source
		WHERE  source."participantType" = 'guest'
		  AND  source."participantId"   = ${guestId}
		  AND  target."transactionId"   = source."transactionId"
		  AND  target."participantType" = 'user'
		  AND  target."participantId"   = ${userId}
	`;

	// Step 2: Delete the guest rows that were merged (would conflict on unique)
	await tx.$executeRaw`
		DELETE FROM split_participant
		WHERE  "participantType" = 'guest'
		  AND  "participantId"   = ${guestId}
		  AND  "transactionId" IN (
			SELECT "transactionId"
			FROM   split_participant
			WHERE  "participantType" = 'user'
			  AND  "participantId"   = ${userId}
		  )
	`;

	// Step 3: Update remaining guest rows to user (no conflict now)
	await tx.splitParticipant.updateMany({
		where: { participantType: "guest", participantId: guestId },
		data: { participantType: "user", participantId: userId },
	});
}

async function claimShadowProfiles(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	userEmail: string,
): Promise<number> {
	const result = await db.shadowProfile.updateMany({
		where: {
			email: userEmail.toLowerCase(),
			claimedById: null,
		},
		data: {
			claimedById: userId,
			claimedAt: new Date(),
		},
	});
	return result.count;
}

import type { Prisma, PrismaClient } from "~prisma";

/**
 * Explicit shadow-profile claiming (claim link + "are you one of these people?"
 * chooser).
 *
 * The EXISTING email auto-claim at signup (`claimShadowProfiles` in
 * guest-migration.service.ts) only stamps `claimedById`/`claimedAt`; balances
 * are then merged at read time by `resolveClaimAliases` (see identity.ts). This
 * service does the same stamping, and ADDITIONALLY promotes the shadow's project
 * memberships to the claiming user so they actually gain access to those
 * projects — a shadow that never had an account obviously can't have logged in.
 *
 * Split/settlement rows are intentionally NOT rewritten: the balance layer
 * already treats `{shadow}` and its claiming `{user}` as one party, so history
 * is summed without a destructive migration.
 *
 * All operations MUST use the global (RLS-bypassing) db: a user claiming a ghost
 * has, by definition, no prior relationship the RLS policy would grant, so a
 * user-scoped client could not read the shadow row.
 */

interface ClaimResult {
	shadowId: string;
	shadowName: string;
	projectIds: string[];
	alreadyClaimed: boolean;
}

const ROLE_PRIORITY: Record<string, number> = {
	ORGANIZER: 3,
	EDITOR: 2,
	CONTRIBUTOR: 1,
	VIEWER: 0,
};

/**
 * Claims a shadow profile for `userId`, promoting its project memberships.
 *
 * Idempotent for the same claimer: re-claiming a shadow already claimed by
 * `userId` is a no-op success. Throws if the shadow is already claimed by
 * someone ELSE (guarding against hijacking a link that has been used).
 */
export async function claimShadowProfile(
	db: PrismaClient,
	shadowId: string,
	userId: string,
): Promise<ClaimResult> {
	const shadow = await db.shadowProfile.findUnique({
		where: { id: shadowId },
		select: { id: true, name: true, claimedById: true },
	});

	if (!shadow) {
		return { shadowId, shadowName: "", projectIds: [], alreadyClaimed: false };
	}

	if (shadow.claimedById && shadow.claimedById !== userId) {
		throw new AlreadyClaimedError();
	}

	const projectIds: string[] = [];

	await db.$transaction(async (tx) => {
		// Stamp the claim (skip if this user already claimed it — idempotent).
		if (shadow.claimedById !== userId) {
			await tx.shadowProfile.update({
				where: { id: shadowId },
				data: { claimedById: userId, claimedAt: new Date() },
			});
		}

		// Promote each of the shadow's project memberships to the user.
		const memberships = await tx.projectParticipant.findMany({
			where: { participantType: "shadow", participantId: shadowId },
		});

		for (const shadowMembership of memberships) {
			projectIds.push(shadowMembership.projectId);

			const existingUserMembership = await tx.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId: shadowMembership.projectId,
						participantType: "user",
						participantId: userId,
					},
				},
			});

			if (existingUserMembership) {
				// User already in project: KEEP their existing role unchanged and
				// drop the shadow membership. Never upgrade to the shadow's role —
				// claiming a ghost must not be a privilege-escalation vector.
				await tx.projectParticipant.delete({
					where: { id: shadowMembership.id },
				});
			} else {
				// Convert shadow membership → user membership, but cap the granted
				// role at CONTRIBUTOR: a claim must never confer EDITOR/ORGANIZER.
				const cappedRole =
					shadowMembership.role === "ORGANIZER" ||
					shadowMembership.role === "EDITOR"
						? "CONTRIBUTOR"
						: shadowMembership.role;
				await tx.projectParticipant.update({
					where: { id: shadowMembership.id },
					data: {
						participantType: "user",
						participantId: userId,
						role: cappedRole,
					},
				});
			}
		}
	});

	return {
		shadowId,
		shadowName: shadow.name,
		projectIds: [...new Set(projectIds)],
		alreadyClaimed: shadow.claimedById === userId,
	};
}

/** Thrown when a shadow is already claimed by a different user. */
export class AlreadyClaimedError extends Error {
	constructor() {
		super("This person has already been linked to another account");
		this.name = "AlreadyClaimedError";
	}
}

/**
 * Returns the unclaimed shadow profiles that are participants of a project, for
 * the "are you one of these people?" chooser shown on join. Uses global db so
 * the joining user (who may not yet be related to these shadows) can see them.
 */
export async function listUnclaimedProjectGhosts(
	db: PrismaClient | Prisma.TransactionClient,
	projectId: string,
): Promise<Array<{ id: string; name: string }>> {
	const memberships = await db.projectParticipant.findMany({
		where: { projectId, participantType: "shadow" },
		select: { participantId: true },
	});
	const shadowIds = memberships.map((m) => m.participantId);
	if (shadowIds.length === 0) return [];

	const shadows = await db.shadowProfile.findMany({
		where: { id: { in: shadowIds }, claimedById: null },
		select: { id: true, name: true },
		orderBy: { name: "asc" },
	});
	return shadows;
}

/**
 * Merges a shadow profile into a guest session: a guest who just joined a
 * project recognises themselves as an existing ghost and links instead of
 * creating a duplicate. The guest "absorbs" the ghost — all of the ghost's
 * historical refs (splits, settlements, payments, audit, membership) are
 * re-pointed to the guest, and the now-empty shadow row is deleted.
 *
 * This is the guest-facing counterpart of the user email auto-claim; it reuses
 * the same 3-step split-merge pattern that guest-migration.service.ts uses to
 * respect the SplitParticipant unique constraint.
 *
 * Must run with the RLS-bypassing global db (the joining guest has no prior
 * relationship to the ghost's rows).
 */
export async function mergeShadowIntoGuest(
	db: PrismaClient,
	shadowId: string,
	guestSessionId: string,
	projectId: string,
): Promise<{ shadowName: string }> {
	const shadow = await db.shadowProfile.findUnique({
		where: { id: shadowId },
		select: { id: true, name: true, claimedById: true },
	});
	if (!shadow) return { shadowName: "" };
	if (shadow.claimedById) throw new AlreadyClaimedError();

	// Only allow linking to a ghost that actually belongs to this project.
	const shadowMembership = await db.projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: {
				projectId,
				participantType: "shadow",
				participantId: shadowId,
			},
		},
		select: { id: true, role: true },
	});
	if (!shadowMembership) {
		throw new Error("That person is not part of this project");
	}

	await db.$transaction(async (tx) => {
		// ── ProjectParticipant: merge shadow membership into the guest's ──
		const guestMembership = await tx.projectParticipant.findUnique({
			where: {
				projectId_participantType_participantId: {
					projectId,
					participantType: "guest",
					participantId: guestSessionId,
				},
			},
		});
		if (guestMembership) {
			const shadowPriority = ROLE_PRIORITY[shadowMembership.role] ?? 0;
			const guestPriority = ROLE_PRIORITY[guestMembership.role] ?? 0;
			if (shadowPriority > guestPriority) {
				await tx.projectParticipant.update({
					where: { id: guestMembership.id },
					data: { role: shadowMembership.role },
				});
			}
			await tx.projectParticipant.delete({
				where: { id: shadowMembership.id },
			});
		} else {
			await tx.projectParticipant.update({
				where: { id: shadowMembership.id },
				data: { participantType: "guest", participantId: guestSessionId },
			});
		}

		// ── SharedTransaction: paidBy / createdBy ──
		await tx.sharedTransaction.updateMany({
			where: { paidByType: "shadow", paidById: shadowId },
			data: { paidByType: "guest", paidById: guestSessionId },
		});
		await tx.sharedTransaction.updateMany({
			where: { createdByType: "shadow", createdById: shadowId },
			data: { createdByType: "guest", createdById: guestSessionId },
		});

		// ── SplitParticipant: 3-step merge for the unique constraint ──
		await tx.$executeRaw`
			UPDATE split_participant AS target
			SET    "shareAmount" = target."shareAmount" + source."shareAmount"
			FROM   split_participant AS source
			WHERE  source."participantType" = 'shadow'
			  AND  source."participantId"   = ${shadowId}
			  AND  target."transactionId"   = source."transactionId"
			  AND  target."participantType" = 'guest'
			  AND  target."participantId"   = ${guestSessionId}
		`;
		await tx.$executeRaw`
			DELETE FROM split_participant
			WHERE  "participantType" = 'shadow'
			  AND  "participantId"   = ${shadowId}
			  AND  "transactionId" IN (
				SELECT "transactionId"
				FROM   split_participant
				WHERE  "participantType" = 'guest'
				  AND  "participantId"   = ${guestSessionId}
			  )
		`;
		await tx.splitParticipant.updateMany({
			where: { participantType: "shadow", participantId: shadowId },
			data: { participantType: "guest", participantId: guestSessionId },
		});

		// ── Settlement: from / to ──
		await tx.settlement.updateMany({
			where: { fromParticipantType: "shadow", fromParticipantId: shadowId },
			data: { fromParticipantType: "guest", fromParticipantId: guestSessionId },
		});
		await tx.settlement.updateMany({
			where: { toParticipantType: "shadow", toParticipantId: shadowId },
			data: { toParticipantType: "guest", toParticipantId: guestSessionId },
		});

		// ── AuditLogEntry: actor ──
		await tx.auditLogEntry.updateMany({
			where: { actorType: "shadow", actorId: shadowId },
			data: { actorType: "guest", actorId: guestSessionId },
		});

		// ── Delete the now-empty shadow profile ──
		await tx.shadowProfile.delete({ where: { id: shadowId } });
	});

	return { shadowName: shadow.name };
}

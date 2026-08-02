import type { Prisma, PrismaClient } from "~prisma";

/**
 * Explicit shadow-profile claiming (claim link + "are you one of these people?"
 * chooser).
 *
 * Both the user-claim path (`claimShadowProfile`) and the guest-link path
 * (`mergeShadowIntoGuest`) fully ABSORB the shadow into the claiming identity:
 * every polymorphic reference (splits, payments, settlements, audit, project
 * membership) is re-pointed from the shadow to the claiming user/guest, and the
 * now-empty shadow row is deleted. After a claim the history therefore shows the
 * real person's identity directly — a claimed split no longer displays the old
 * ghost name.
 *
 * (The lightweight email auto-claim at signup — `claimShadowProfiles` in
 * guest-migration.service.ts — routes through `claimShadowProfile` so those
 * claims also fully absorb the shadow rather than merely stamping claimedById.)
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

/** A polymorphic participant reference type (`ParticipantType`). */
type ParticipantType = "user" | "guest" | "shadow";

/**
 * Re-points every non-membership polymorphic reference from a shadow onto a
 * target participant (a claiming user or guest), using the 3-step merge that
 * respects the SplitParticipant unique constraint. Membership rows are handled
 * separately by each caller because their role-capping rules differ.
 *
 * Shared by `claimShadowProfile` (target = user) and `mergeShadowIntoGuest`
 * (target = guest) so both paths absorb history identically.
 */
async function repointShadowReferences(
	tx: Prisma.TransactionClient,
	shadowId: string,
	targetType: ParticipantType,
	targetId: string,
): Promise<void> {
	// ── SharedTransaction: paidBy / createdBy ──
	await tx.sharedTransaction.updateMany({
		where: { paidByType: "shadow", paidById: shadowId },
		data: { paidByType: targetType, paidById: targetId },
	});
	await tx.sharedTransaction.updateMany({
		where: { createdByType: "shadow", createdById: shadowId },
		data: { createdByType: targetType, createdById: targetId },
	});

	// ── SplitParticipant: 3-step merge for the unique constraint ──
	// The target may already be a split participant on the same transaction (e.g.
	// they were added as a user before claiming the ghost), so sum-then-delete
	// the conflicting rows before re-pointing the rest.
	await tx.$executeRaw`
		UPDATE split_participant AS target
		SET    "shareAmount" = target."shareAmount" + source."shareAmount"
		FROM   split_participant AS source
		WHERE  source."participantType" = 'shadow'
		  AND  source."participantId"   = ${shadowId}
		  AND  target."transactionId"   = source."transactionId"
		  AND  target."participantType" = ${targetType}::"ParticipantType"
		  AND  target."participantId"   = ${targetId}
	`;
	await tx.$executeRaw`
		DELETE FROM split_participant
		WHERE  "participantType" = 'shadow'
		  AND  "participantId"   = ${shadowId}
		  AND  "transactionId" IN (
			SELECT "transactionId"
			FROM   split_participant
			WHERE  "participantType" = ${targetType}::"ParticipantType"
			  AND  "participantId"   = ${targetId}
		  )
	`;
	await tx.splitParticipant.updateMany({
		where: { participantType: "shadow", participantId: shadowId },
		data: { participantType: targetType, participantId: targetId },
	});

	// ── Settlement: from / to ──
	await tx.settlement.updateMany({
		where: { fromParticipantType: "shadow", fromParticipantId: shadowId },
		data: { fromParticipantType: targetType, fromParticipantId: targetId },
	});
	await tx.settlement.updateMany({
		where: { toParticipantType: "shadow", toParticipantId: shadowId },
		data: { toParticipantType: targetType, toParticipantId: targetId },
	});

	// ── AuditLogEntry: actor ──
	await tx.auditLogEntry.updateMany({
		where: { actorType: "shadow", actorId: shadowId },
		data: { actorType: targetType, actorId: targetId },
	});
}

/**
 * Claims a shadow profile for `userId`, fully absorbing it: the shadow's project
 * memberships are promoted to the user, all of its historical refs (splits,
 * payments, settlements, audit) are re-pointed to the user, and the shadow row
 * is deleted. The claimed person then appears as the real user everywhere.
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

	// Already claimed by THIS user: nothing left to absorb (a prior claim already
	// re-pointed everything and deleted the shadow). Idempotent success.
	if (shadow.claimedById === userId) {
		return {
			shadowId,
			shadowName: shadow.name,
			projectIds: [],
			alreadyClaimed: true,
		};
	}

	if (shadow.claimedById) {
		throw new AlreadyClaimedError();
	}

	const projectIds: string[] = [];

	await db.$transaction(async (tx) => {
		// ── ProjectParticipant: promote each shadow membership to the user ──
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
				// User already in project: KEEP their existing role unchanged and drop
				// the shadow membership. Never upgrade to the shadow's role — claiming
				// a ghost must not be a privilege-escalation vector.
				await tx.projectParticipant.delete({
					where: { id: shadowMembership.id },
				});
			} else {
				// Convert shadow membership → user membership, but cap the granted role
				// at CONTRIBUTOR: a claim must never confer EDITOR/ORGANIZER.
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

		// ── Re-point all other refs, then delete the now-empty shadow ──
		await repointShadowReferences(tx, shadowId, "user", userId);
		await tx.shadowProfile.delete({ where: { id: shadowId } });
	});

	return {
		shadowId,
		shadowName: shadow.name,
		projectIds: [...new Set(projectIds)],
		alreadyClaimed: false,
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
 * This is the guest-facing counterpart of the user claim; it reuses the same
 * `repointShadowReferences` merge helper as `claimShadowProfile` so both paths
 * absorb history identically.
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
		// A guest (self-service, magic-link) must never inherit ORGANIZER/EDITOR from
		// a shadow — cap the promoted role at CONTRIBUTOR. Defense-in-depth: shadows
		// are already capped at write time (addParticipant / updateParticipantRole).
		const cappedShadowRole =
			shadowMembership.role === "ORGANIZER" ||
			shadowMembership.role === "EDITOR"
				? "CONTRIBUTOR"
				: shadowMembership.role;
		if (guestMembership) {
			const shadowPriority = ROLE_PRIORITY[cappedShadowRole] ?? 0;
			const guestPriority = ROLE_PRIORITY[guestMembership.role] ?? 0;
			if (shadowPriority > guestPriority) {
				await tx.projectParticipant.update({
					where: { id: guestMembership.id },
					data: { role: cappedShadowRole },
				});
			}
			await tx.projectParticipant.delete({
				where: { id: shadowMembership.id },
			});
		} else {
			await tx.projectParticipant.update({
				where: { id: shadowMembership.id },
				data: {
					participantType: "guest",
					participantId: guestSessionId,
					role: cappedShadowRole,
				},
			});
		}

		// ── Re-point all other refs, then delete the now-empty shadow ──
		await repointShadowReferences(tx, shadowId, "guest", guestSessionId);
		await tx.shadowProfile.delete({ where: { id: shadowId } });
	});

	return { shadowName: shadow.name };
}

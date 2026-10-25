import type { Prisma, PrismaClient } from "~prisma";
import { repointSettlementParty } from "./payments/participants";
import { mergeOverlappingSplitRows } from "./shared-expenses/split-merge";

/**
 * Explicit shadow-profile claiming (claim link + "are you one of these people?"
 * chooser).
 *
 * Both the user-claim path (`claimShadowProfile`) and the guest-link path
 * (`mergeShadowIntoGuest`) fully ABSORB the shadow into the claiming identity:
 * every polymorphic reference (splits, payments, settlements, audit, project
 * membership) is re-pointed from the shadow to the claiming user/guest, and the
 * now-empty shadow row is deleted. After a claim the history therefore shows the
 * real person's identity directly, a claimed split no longer displays the old
 * ghost name.
 *
 * (The email auto-claim once a user's email is verified, `claimShadowProfiles` in
 * guest-migration.service.ts, routes through `claimShadowProfile` so those
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
	await mergeOverlappingSplitRows(
		tx,
		{ participantType: "shadow", participantId: shadowId },
		{ participantType: targetType, participantId: targetId },
	);
	await tx.splitParticipant.updateMany({
		where: { participantType: "shadow", participantId: shadowId },
		data: { participantType: targetType, participantId: targetId },
	});

	// ── Settlement and payment headers: from / to ──
	await repointSettlementParty(
		tx,
		{ participantType: "shadow", participantId: shadowId },
		{ participantType: targetType, participantId: targetId },
	);

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
				// the shadow membership. Never upgrade to the shadow's role, claiming
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

/**
 * Whether `userId` may mint a claim link for a shadow, i.e. hand its identity
 * to someone else. Claiming converts the shadow's membership in EVERY project
 * it belongs to, so the issuer must be an EDITOR or ORGANIZER of every one of
 * them: the link then grants nothing the issuer couldn't grant by adding the
 * person directly. A shadow with no projects is a standalone contact and only
 * its creator may share it.
 *
 * Checked when the link is minted and again when it is claimed (against the
 * issuer recorded in the token), so memberships that changed in between are
 * honoured. Reads only project_participant, which any db client can see.
 */
export async function canMintClaimLink(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	shadow: { id: string; createdById: string },
): Promise<boolean> {
	const memberships = await db.projectParticipant.findMany({
		where: { participantType: "shadow", participantId: shadow.id },
		select: { projectId: true },
	});
	if (memberships.length === 0) {
		return shadow.createdById === userId;
	}

	const projectIds = [...new Set(memberships.map((m) => m.projectId))];
	const issuerRows = await db.projectParticipant.findMany({
		where: {
			projectId: { in: projectIds },
			participantType: "user",
			participantId: userId,
		},
		select: { projectId: true, role: true },
	});
	const managed = new Set(
		issuerRows
			.filter((r) => r.role === "ORGANIZER" || r.role === "EDITOR")
			.map((r) => r.projectId),
	);
	return projectIds.every((id) => managed.has(id));
}

/**
 * Thrown when a guest tries to link to a ghost that is also part of other
 * projects, or has expenses or settlements outside this one. Only a claim link
 * (minted by someone who runs all of them) may absorb such a ghost.
 */
export class GhostInOtherProjectsError extends Error {
	constructor() {
		super(
			"This person is also part of other projects or has expenses outside this one, so you can't link to them here. Join as yourself and ask an organizer for a claim link.",
		);
		this.name = "GhostInOtherProjectsError";
	}
}

/** Thrown when a shadow is already claimed by a different user. */
export class AlreadyClaimedError extends Error {
	constructor() {
		super("This person has already been linked to another account");
		this.name = "AlreadyClaimedError";
	}
}

/**
 * Of the given ghosts, returns those with anything outside `projectId`: a
 * membership in another project, or an expense (as payer or split member) or
 * a settlement that belongs to another project or to no project at all.
 *
 * Absorbing a ghost re-points ALL of its history, so a guest may only absorb
 * one whose history lives entirely in the project the guest joined. Checking
 * memberships alone is not enough: a ghost removed from a project keeps its
 * expenses there, and direct (project-less) expenses have no membership row.
 */
async function ghostsWithHistoryOutsideProject(
	db: PrismaClient | Prisma.TransactionClient,
	shadowIds: string[],
	projectId: string,
): Promise<Set<string>> {
	if (shadowIds.length === 0) return new Set();
	// `projectId: { not }` alone skips NULL rows in SQL, so name them too.
	const outsideProject = {
		OR: [{ projectId: null }, { projectId: { not: projectId } }],
	};

	const [memberships, paid, splits, sent, received] = await Promise.all([
		db.projectParticipant.findMany({
			where: {
				participantType: "shadow",
				participantId: { in: shadowIds },
				NOT: { projectId },
			},
			select: { participantId: true },
		}),
		db.sharedTransaction.findMany({
			where: {
				paidByType: "shadow",
				paidById: { in: shadowIds },
				...outsideProject,
			},
			select: { paidById: true },
		}),
		db.splitParticipant.findMany({
			where: {
				participantType: "shadow",
				participantId: { in: shadowIds },
				transaction: outsideProject,
			},
			select: { participantId: true },
		}),
		db.settlement.findMany({
			where: {
				fromParticipantType: "shadow",
				fromParticipantId: { in: shadowIds },
				...outsideProject,
			},
			select: { fromParticipantId: true },
		}),
		db.settlement.findMany({
			where: {
				toParticipantType: "shadow",
				toParticipantId: { in: shadowIds },
				...outsideProject,
			},
			select: { toParticipantId: true },
		}),
	]);

	return new Set([
		...memberships.map((m) => m.participantId),
		...paid.map((t) => t.paidById),
		...splits.map((s) => s.participantId),
		...sent.map((s) => s.fromParticipantId),
		...received.map((s) => s.toParticipantId),
	]);
}

/**
 * Returns the unclaimed shadow profiles that are participants of a project, for
 * the "are you one of these people?" chooser shown on join. Uses global db so
 * the joining user (who may not yet be related to these shadows) can see them.
 */
export async function listUnclaimedProjectGhosts(
	db: PrismaClient | Prisma.TransactionClient,
	projectId: string,
): Promise<Array<{ id: string; name: string; linkable: boolean }>> {
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

	// Ghosts with history outside this project are still listed (the joiner
	// may recognise themselves) but can't be linked by a guest; see
	// mergeShadowIntoGuest.
	const elsewhere = await ghostsWithHistoryOutsideProject(
		db,
		shadows.map((s) => s.id),
		projectId,
	);

	return shadows.map((s) => ({ ...s, linkable: !elsewhere.has(s.id) }));
}

/**
 * Merges a shadow profile into a guest session: a guest who just joined a
 * project recognises themselves as an existing ghost and links instead of
 * creating a duplicate. The guest "absorbs" the ghost, all of the ghost's
 * historical refs (splits, settlements, payments, audit) are re-pointed to the
 * guest, the shadow's membership row is dropped (the guest keeps the role its
 * invite link granted), and the now-empty shadow row is deleted.
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
		select: { id: true },
	});
	if (!shadowMembership) {
		throw new Error("That person is not part of this project");
	}

	await db.$transaction(async (tx) => {
		// ── ProjectParticipant: drop the shadow membership, keep the guest's ──
		// The guest's role is whatever its invite link granted, and absorbing a
		// ghost must never raise it (a VIEWER link must not become CONTRIBUTOR via
		// a CONTRIBUTOR ghost). The guest must already be a member: a guest whose
		// membership was removed can't rejoin by taking over a ghost.
		const guestMembership = await tx.projectParticipant.findUnique({
			where: {
				projectId_participantType_participantId: {
					projectId,
					participantType: "guest",
					participantId: guestSessionId,
				},
			},
			select: { id: true },
		});
		if (!guestMembership) {
			throw new Error("You are not a participant of this project");
		}

		// The merge re-points the ghost's history everywhere and deletes it,
		// but the guest only belongs to this project. A ghost with memberships,
		// expenses or settlements outside it needs a claim link from someone
		// who runs all of them. (Checked inside the transaction so a concurrent
		// add can't slip by.)
		const elsewhere = await ghostsWithHistoryOutsideProject(
			tx,
			[shadowId],
			projectId,
		);
		if (elsewhere.size > 0) {
			throw new GhostInOtherProjectsError();
		}

		await tx.projectParticipant.delete({
			where: { id: shadowMembership.id },
		});

		// ── Re-point all other refs, then delete the now-empty shadow ──
		await repointShadowReferences(tx, shadowId, "guest", guestSessionId);
		await tx.shadowProfile.delete({ where: { id: shadowId } });
	});

	return { shadowName: shadow.name };
}

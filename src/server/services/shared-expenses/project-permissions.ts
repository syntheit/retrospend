import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient, ProjectParticipant } from "~prisma";
import type { ParticipantRef } from "./types";

type TransactionWithParticipants = Prisma.SharedTransactionGetPayload<{
	include: { splitParticipants: true };
}>;

type DbClient = PrismaClient | Prisma.TransactionClient;

const ROLE_RANK: Record<string, number> = {
	VIEWER: 0,
	CONTRIBUTOR: 1,
	EDITOR: 2,
	ORGANIZER: 3,
};

/**
 * Builds a `projectId -> highest role` map for the caller across the given
 * projects. The caller is expressed as one or more participant refs
 * (`callerRefs`) so that all of a person's claim aliases — e.g. a claimed
 * shadow and the user who claimed it — are considered together. If the caller
 * holds a membership under any alias, that role is returned; when multiple
 * aliases are members of the same project the highest-ranked role wins.
 *
 * This is what powers the read-side `canEdit`/`canDelete` flags: a project's
 * ORGANIZER/EDITOR must see edit affordances on EVERY expense in that project,
 * even ones they didn't create and even ones surfaced (in the person view)
 * under a different alias identity. Keying the lookup on a single canonical ref
 * would leave `role` undefined for those rows and wrongly gate the ⋯ menu off.
 */
export async function buildCallerRoleMap(
	db: DbClient,
	callerRefs: ParticipantRef[],
	projectIds: string[],
): Promise<Map<string, string>> {
	const roleMap = new Map<string, string>();
	if (projectIds.length === 0 || callerRefs.length === 0) return roleMap;

	const memberships = await (db as PrismaClient).projectParticipant.findMany({
		where: {
			projectId: { in: projectIds },
			OR: callerRefs.map((ref) => ({
				participantType: ref.participantType,
				participantId: ref.participantId,
			})),
		},
		select: { projectId: true, role: true },
	});

	for (const m of memberships) {
		const existing = roleMap.get(m.projectId);
		if (
			existing === undefined ||
			(ROLE_RANK[m.role] ?? -1) > (ROLE_RANK[existing] ?? -1)
		) {
			roleMap.set(m.projectId, m.role);
		}
	}

	return roleMap;
}

/**
 * Derives the read-side edit/delete permission for a single transaction from a
 * caller-role map (see {@link buildCallerRoleMap}). Mirrors the authoritative
 * write-side rules in {@link assertCanModifyTransaction} exactly so the ⋯ menu
 * never offers an action the mutation would reject, and never hides one it
 * would allow:
 *
 * - Locked (settled) transactions: never editable.
 * - Project-scoped: ORGANIZER/EDITOR may edit any expense; CONTRIBUTOR only
 *   their own; VIEWER / non-members none.
 * - Standalone (no project): only the creator.
 *
 * `isCreator` must already account for the caller's claim aliases.
 */
export function deriveCanModify(args: {
	isLocked: boolean;
	projectId: string | null;
	isCreator: boolean;
	roleMap: Map<string, string>;
}): boolean {
	const { isLocked, projectId, isCreator, roleMap } = args;
	if (isLocked) return false;
	if (projectId) {
		const role = roleMap.get(projectId);
		return (
			role === "ORGANIZER" ||
			role === "EDITOR" ||
			(role === "CONTRIBUTOR" && isCreator)
		);
	}
	return isCreator;
}

/**
 * Fetches the ProjectParticipant record for the given participant and verifies
 * their role meets the minimum required. Throws FORBIDDEN or NOT_FOUND on failure.
 *
 * For "viewerLink" participants (anonymous viewers authenticated via a magic link),
 * no DB lookup is performed - they always hold VIEWER role.
 */
export async function requireProjectRole(
	db: DbClient,
	projectId: string,
	participantType: "user" | "guest" | "shadow" | "viewerLink",
	participantId: string,
	minimumRole: "VIEWER" | "CONTRIBUTOR" | "EDITOR" | "ORGANIZER",
): Promise<ProjectParticipant> {
	// Anonymous viewer link: no ProjectParticipant record exists; role is always VIEWER.
	if (participantType === "viewerLink") {
		const requiredRank = ROLE_RANK[minimumRole] ?? 0;
		if (requiredRank > (ROLE_RANK.VIEWER ?? 0)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `This action requires the ${minimumRole} role or higher`,
			});
		}
		return {
			id: `viewerLink:${participantId}`,
			projectId,
			participantType: "guest",
			participantId,
			role: "VIEWER",
			joinedAt: new Date(),
		} as unknown as ProjectParticipant;
	}

	const participant = await (db as PrismaClient).projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: {
				projectId,
				participantType,
				participantId,
			},
		},
	});

	if (!participant) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "You are not a participant of this project",
		});
	}

	const participantRank = ROLE_RANK[participant.role] ?? -1;
	const requiredRank = ROLE_RANK[minimumRole] ?? 0;

	if (participantRank < requiredRank) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `This action requires the ${minimumRole} role or higher`,
		});
	}

	return participant;
}

/**
 * Fetches a SharedTransaction, verifies the caller has permission to modify
 * (edit or delete) it, and returns the full record including splitParticipants.
 *
 * Permission rules:
 * - Settled (isLocked) transactions: nobody can modify
 * - Standalone (no projectId): only the creator
 * - Project-scoped:
 *   - ORGANIZER / EDITOR: can modify any transaction
 *   - CONTRIBUTOR: can only modify transactions they created
 *   - VIEWER: cannot modify anything
 *
 * Throws TRPCError (NOT_FOUND or FORBIDDEN) on failure.
 */
export async function assertCanModifyTransaction(
	db: DbClient,
	transactionId: string,
	participantType: "user" | "guest" | "shadow",
	participantId: string,
): Promise<TransactionWithParticipants> {
	const transaction = await (db as PrismaClient).sharedTransaction.findUnique({
		where: { id: transactionId },
		include: { splitParticipants: true },
	});

	if (!transaction) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Shared transaction not found",
		});
	}

	if (transaction.isLocked) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Settled transactions cannot be modified",
		});
	}

	const isCreator =
		transaction.createdByType === participantType &&
		transaction.createdById === participantId;

	if (transaction.projectId) {
		const projectParticipant = await (
			db as PrismaClient
		).projectParticipant.findUnique({
			where: {
				projectId_participantType_participantId: {
					projectId: transaction.projectId,
					participantType,
					participantId,
				},
			},
		});

		if (!projectParticipant) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You are not a participant of this project",
			});
		}

		const role = projectParticipant.role;
		if (role === "ORGANIZER" || role === "EDITOR") {
			return transaction;
		}
		if (role === "CONTRIBUTOR") {
			if (!isCreator) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only edit expenses you created",
				});
			}
			return transaction;
		}
		// VIEWER
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Viewers cannot edit or delete expenses",
		});
	}

	// Standalone transaction
	if (!isCreator) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the creator can edit this expense",
		});
	}

	return transaction;
}

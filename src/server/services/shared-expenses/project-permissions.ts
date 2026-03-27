import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient, ProjectParticipant } from "~prisma";

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

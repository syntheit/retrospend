/**
 * What deleting an account does to the projects its user runs: who takes
 * over a project they alone organize, and who inherits the ones they created
 * (a project is deleted with its creator, so it must be handed on first).
 */
import type { PrismaClient, ProjectRole } from "~prisma";
import { DELETED_USER_SENTINEL } from "./deleted-sentinels";

type PrismaTx = Omit<
	PrismaClient,
	"$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Picks who takes over a project whose only organizer is deleting their
 * account: the longest-standing registered user, preferring EDITOR, then
 * CONTRIBUTOR, then VIEWER. Ghosts (shadows) and guests are never promoted:
 * neither can sign in, so an ORGANIZER ghost would leave the project with no
 * one able to run it. Returns null when no other registered user is a member.
 */
export async function findSuccessorOrganizer(
	db: PrismaClient | PrismaTx,
	projectId: string,
	userId: string,
	roles: readonly ProjectRole[] = ["EDITOR", "CONTRIBUTOR", "VIEWER"],
) {
	for (const role of roles) {
		const candidate = await (db as PrismaClient).projectParticipant.findFirst({
			where: {
				projectId,
				participantType: "user",
				participantId: { notIn: [userId, DELETED_USER_SENTINEL] },
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
export async function countOtherUserOrganizers(
	db: PrismaClient | PrismaTx,
	projectId: string,
	userId: string,
): Promise<number> {
	return (db as PrismaClient).projectParticipant.count({
		where: {
			projectId,
			participantType: "user",
			participantId: { notIn: [userId, DELETED_USER_SENTINEL] },
			role: "ORGANIZER",
		},
	});
}

/**
 * A project is deleted with the user who created it (project.createdById
 * cascades), so one that others still use is handed to a remaining
 * registered member first: the one who runs it now, else the longest-standing
 * by role. A project left with no registered member goes with its creator.
 * Runs after preDeletionCleanup, which has already promoted a new organizer.
 */
export async function handOverCreatedProjects(
	tx: PrismaTx,
	userId: string,
): Promise<void> {
	const created = await tx.project.findMany({
		where: { createdById: userId },
		select: { id: true },
	});
	for (const { id } of created) {
		const heir = await findSuccessorOrganizer(tx, id, userId, [
			"ORGANIZER",
			"EDITOR",
			"CONTRIBUTOR",
			"VIEWER",
		]);
		if (heir)
			await tx.project.update({
				where: { id },
				data: { createdById: heir.participantId },
			});
	}
}

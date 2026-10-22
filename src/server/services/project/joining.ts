/**
 * Adding people to a project, with the default join date (join-date.ts):
 * invite links and ghosts split into an expense.
 */
import type { Prisma } from "~prisma";
import { defaultJoinedOn } from "./join-date";

type Tx = Prisma.TransactionClient;

/** Adds a project member with the default join date (invite links). */
export async function joinProject(
	tx: Tx,
	data: {
		projectId: string;
		participantType: "user" | "guest" | "shadow";
		participantId: string;
		role: "ORGANIZER" | "EDITOR" | "CONTRIBUTOR" | "VIEWER";
	},
	actorUserId: string | null,
) {
	const joinedOn = await defaultJoinedOn(tx, data.projectId, actorUserId);
	return tx.projectParticipant.create({ data: { ...data, joinedOn } });
}

/**
 * Adds the ghosts among `refs` that are not yet members as contributors, so a
 * ghost split into an expense shows in the project roster (balances,
 * settlement). They join no later than the expense's day. Callers check
 * that the actor may add each ghost first (assertShadowsAddable).
 */
export async function addGhostMembers(
	tx: Tx,
	projectId: string,
	refs: ReadonlyArray<{ participantType: string; participantId: string }>,
	actorUserId: string | null,
	expenseDate: Date,
) {
	const ghosts = new Set(
		refs
			.filter((r) => r.participantType === "shadow")
			.map((r) => r.participantId),
	);
	for (const participantId of ghosts) {
		const key = {
			projectId,
			participantType: "shadow" as const,
			participantId,
		};
		const where = { projectId_participantType_participantId: key };
		if (await tx.projectParticipant.findUnique({ where })) continue;
		const joinedOn = await defaultJoinedOn(tx, projectId, actorUserId, {
			onDay: expenseDate,
		});
		await tx.projectParticipant.create({
			data: { ...key, role: "CONTRIBUTOR", joinedOn },
		});
	}
}

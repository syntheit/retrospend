/**
 * A project's people for the Add expense sheet: everyone who is a member on
 * the expense's day (RC-11, the same rule new expenses use), named, without
 * you, and without a limit. The project list keeps only the first few for
 * faces; the split must never lose anyone.
 */
import type { IsoDate } from "../project/membership";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import type { PrismaClient } from "~prisma";
import { resolveParticipantNames } from "../project/identities";
import { membersOn } from "../project/membership.service";

export interface EntryProjectMember {
	readonly participantType: "user" | "guest" | "shadow";
	readonly participantId: string;
	readonly name: string;
	readonly avatarUrl: string | null;
}

export async function entryProjectMembers(
	db: PrismaClient,
	userId: string,
	projectId: string,
	day: IsoDate,
): Promise<EntryProjectMember[]> {
	// Who may add an expense here may see who it would include.
	await requireProjectRole(db, projectId, "user", userId, "CONTRIBUTOR");
	const others = (await membersOn(db, projectId, day, userId)).filter(
		(m) => !(m.participantType === "user" && m.participantId === userId),
	);
	const named = await resolveParticipantNames(db, others);
	return named.map((m) => ({
		participantType: m.participantType as EntryProjectMember["participantType"],
		participantId: m.participantId,
		name: m.name,
		avatarUrl: m.avatarUrl,
	}));
}

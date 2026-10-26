/**
 * Who else is on the expenses the user is on, without the amounts. A debtor
 * outside a project sees only their own split row, so these two questions
 * cannot be asked of the table; the database answers them through helpers
 * that return a yes or a count and nothing else (migration co_participant_reads).
 * Both run as the signed-in user: the helpers read the RLS user themselves.
 */
import type { ParticipantType, PrismaClient } from "~prisma";

export interface CoParticipant {
	participantType: "user" | "shadow";
	participantId: string;
	/** How many expenses the user and this person are both on. */
	sharedCount: number;
}

/** Whether the user and `other` have a split row on one expense. */
export async function sharesExpenseWith(
	db: PrismaClient,
	other: { participantType: ParticipantType; participantId: string },
): Promise<boolean> {
	const rows = await db.$transaction(
		(tx) =>
			tx.$queryRaw<
				{ shared: boolean }[]
			>`SELECT shares_expense_with(${other.participantType}, ${other.participantId}) AS shared`,
	);
	return rows[0]?.shared === true;
}

/** The people (users and ghosts) sharing the most expenses with the user, most first. */
export async function coParticipantCounts(
	db: PrismaClient,
	limit: number,
): Promise<CoParticipant[]> {
	return db.$transaction(
		(tx) =>
			tx.$queryRaw<
				CoParticipant[]
			>`SELECT "participantType", "participantId", "sharedCount"
				FROM co_participant_counts(${limit}::int)`,
	);
}

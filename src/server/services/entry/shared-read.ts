/**
 * Who added a shared expense, for its read view ("Martín added this. Only
 * Martín can edit it."). Read through the user-scoped client, so a person
 * not on the expense gets NOT_FOUND like everywhere else.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~prisma";
import { resolveParticipantNames } from "../project/identities";

export interface SharedAuthor {
	readonly participantType: string;
	readonly participantId: string;
	readonly name: string;
	readonly avatarUrl: string | null;
	/** You added it. */
	readonly you: boolean;
}

export async function sharedAuthor(
	db: PrismaClient,
	userId: string,
	id: string,
): Promise<SharedAuthor> {
	const row = await db.sharedTransaction.findUnique({
		where: { id },
		select: { createdByType: true, createdById: true },
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	}
	const [author] = await resolveParticipantNames(db, [
		{ participantType: row.createdByType, participantId: row.createdById },
	]);
	return {
		participantType: row.createdByType,
		participantId: row.createdById,
		name: author?.name ?? "",
		avatarUrl: author?.avatarUrl ?? null,
		you: row.createdByType === "user" && row.createdById === userId,
	};
}

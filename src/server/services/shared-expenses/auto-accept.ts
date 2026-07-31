import type { Prisma } from "~prisma";
import { type ParticipantRef, sameParticipant } from "./types";

/**
 * Batch-fetches the autoAcceptSplits flag for the given user participants in a
 * single query and returns a Map keyed by user id. Non-user participants
 * (guest/shadow) are ignored since they can't approve splits anyway.
 *
 * Shared by the create/update paths (transaction.service.ts) and the
 * rebalance-on-add path (project.ts) so all three resolve auto-accept
 * identically.
 */
export async function getAutoAcceptMap(
	tx: Prisma.TransactionClient,
	participants: ParticipantRef[],
): Promise<Map<string, boolean>> {
	const userIds = participants
		.filter((p) => p.participantType === "user")
		.map((p) => p.participantId);

	const map = new Map<string, boolean>();
	if (userIds.length === 0) return map;

	const users = await tx.user.findMany({
		where: { id: { in: userIds } },
		select: { id: true, autoAcceptSplits: true },
	});
	for (const u of users) {
		map.set(u.id, u.autoAcceptSplits);
	}
	return map;
}

/**
 * Resolves the verification status for a split participant on create/replace.
 * - The actor always ACCEPTED (they authored the change).
 * - A user participant who opted into auto-accept is AUTO_ACCEPTED, so the
 *   split skips the manual approval gate while still recording the change.
 * - Everyone else (opted-out users, guests, shadows) stays PENDING.
 */
export function resolveVerification(
	p: ParticipantRef,
	actor: ParticipantRef,
	autoAcceptMap: Map<string, boolean>,
): {
	status: "ACCEPTED" | "AUTO_ACCEPTED" | "PENDING";
	verifiedAt: Date | undefined;
} {
	if (sameParticipant(p, actor)) {
		return { status: "ACCEPTED", verifiedAt: new Date() };
	}
	if (
		p.participantType === "user" &&
		autoAcceptMap.get(p.participantId) === true
	) {
		return { status: "AUTO_ACCEPTED", verifiedAt: new Date() };
	}
	return { status: "PENDING", verifiedAt: undefined };
}

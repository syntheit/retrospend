import type { Prisma, PrismaClient } from "~prisma";
import type { ParticipantRef } from "./types";

/**
 * Claimed-shadow identity resolution.
 *
 * When a ShadowProfile is claimed by a real user (claimedById set), the shadow
 * ref and the claiming user ref refer to the SAME real-world person. Pre-claim
 * expenses/settlements are attributed to `{shadow, shadowId}` while post-claim
 * ones use `{user, userId}`. To keep balances and history correct we treat both
 * refs as a single "party".
 *
 * These helpers expand a ref into all of its equivalent refs (aliases) so
 * callers can query/group across them.
 */

function key(ref: ParticipantRef): string {
	return `${ref.participantType}:${ref.participantId}`;
}

/**
 * Given a set of participant refs, returns a canonicalization map from every
 * ref key (`type:id`) to a chosen canonical key, treating claimed shadows and
 * their claiming users as the same party.
 *
 * The canonical form for a claimed shadow is always the USER ref, so post-claim
 * history (which uses the user ref) is the stable identity.
 *
 * Uses the caller's (RLS-scoped or global) db; only reads shadow_profile.
 */
export async function resolveClaimAliases(
	db: PrismaClient | Prisma.TransactionClient,
	refs: ParticipantRef[],
): Promise<{
	/** Map from any input ref key -> list of equivalent refs (including itself). */
	aliasesByKey: Map<string, ParticipantRef[]>;
	/** Map from any ref key -> canonical ref key. */
	canonicalKey: (ref: ParticipantRef) => string;
}> {
	const prisma = db as PrismaClient;

	const identity = () => {
		const aliasesByKey = new Map<string, ParticipantRef[]>();
		for (const ref of refs) {
			const k = key(ref);
			if (!aliasesByKey.has(k)) aliasesByKey.set(k, [ref]);
		}
		return { aliasesByKey, canonicalKey: (ref: ParticipantRef) => key(ref) };
	};

	// Defensive: some lightweight test mocks omit the shadowProfile model. When it
	// is unavailable there is nothing to resolve — every ref is its own identity.
	if (!prisma?.shadowProfile?.findMany) {
		return identity();
	}

	const shadowIds = [
		...new Set(
			refs
				.filter((r) => r.participantType === "shadow")
				.map((r) => r.participantId),
		),
	];
	const userIds = [
		...new Set(
			refs
				.filter((r) => r.participantType === "user")
				.map((r) => r.participantId),
		),
	];

	// Shadows in the set that have been claimed -> map shadowId -> userId.
	const claimedShadows =
		shadowIds.length > 0
			? await prisma.shadowProfile.findMany({
					where: { id: { in: shadowIds }, claimedById: { not: null } },
					select: { id: true, claimedById: true },
				})
			: [];

	// Users in the set that have claimed shadows -> map userId -> [shadowId...].
	const shadowsForUsers =
		userIds.length > 0
			? await prisma.shadowProfile.findMany({
					where: { claimedById: { in: userIds } },
					select: { id: true, claimedById: true },
				})
			: [];

	const shadowToUser = new Map<string, string>();
	for (const s of claimedShadows) {
		if (s.claimedById) shadowToUser.set(s.id, s.claimedById);
	}
	const userToShadows = new Map<string, string[]>();
	for (const s of shadowsForUsers) {
		if (!s.claimedById) continue;
		const list = userToShadows.get(s.claimedById) ?? [];
		list.push(s.id);
		userToShadows.set(s.claimedById, list);
		// A shadow claimed by a user is equivalent to that user too.
		shadowToUser.set(s.id, s.claimedById);
	}

	const canonicalRef = (ref: ParticipantRef): ParticipantRef => {
		if (ref.participantType === "shadow") {
			const uid = shadowToUser.get(ref.participantId);
			if (uid) return { participantType: "user", participantId: uid };
		}
		return ref;
	};

	const aliasesByKey = new Map<string, ParticipantRef[]>();
	for (const ref of refs) {
		const k = key(ref);
		if (aliasesByKey.has(k)) continue;
		const aliases: ParticipantRef[] = [ref];
		if (ref.participantType === "user") {
			for (const sid of userToShadows.get(ref.participantId) ?? []) {
				aliases.push({ participantType: "shadow", participantId: sid });
			}
		} else if (ref.participantType === "shadow") {
			const uid = shadowToUser.get(ref.participantId);
			if (uid) {
				aliases.push({ participantType: "user", participantId: uid });
				// Include sibling shadows the same user claimed, for completeness.
				for (const sid of userToShadows.get(uid) ?? []) {
					if (sid !== ref.participantId) {
						aliases.push({
							participantType: "shadow",
							participantId: sid,
						});
					}
				}
			}
		}
		aliasesByKey.set(k, aliases);
	}

	return {
		aliasesByKey,
		canonicalKey: (ref) => key(canonicalRef(ref)),
	};
}

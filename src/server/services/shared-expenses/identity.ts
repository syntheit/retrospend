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
	// is unavailable there is nothing to resolve, every ref is its own identity.
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

// ── Project ledger canonicalization ───────────────────────────────────────────

type Amount = number | { toString(): string };
type RefType = ParticipantRef["participantType"];

interface LedgerTx {
	paidByType: RefType;
	paidById: string;
	splitParticipants: Array<{
		participantType: RefType;
		participantId: string;
		shareAmount: Amount;
	}>;
}

interface LedgerSettlement {
	fromParticipantType: RefType;
	fromParticipantId: string;
	toParticipantType: RefType;
	toParticipantId: string;
}

function parseKey(k: string): ParticipantRef {
	const i = k.indexOf(":");
	return {
		participantType: k.slice(0, i) as RefType,
		participantId: k.slice(i + 1),
	};
}

/**
 * Rewrites a project's expenses and settlements so every claim alias of a
 * person (a claimed shadow and the user who claimed it) appears under ONE
 * ref before they are fed to the group computations (computeSettlementPlan,
 * the period guard, exports).
 *
 * Pairwise balances (computeBalance / computeBalanceByProject) already treat
 * aliases as one party, so a settlement can be recorded against the user
 * while the project's expenses still name the shadow. That happens for shadows
 * claimed before claims re-pointed history (until 2026-08-01 the signup email
 * auto-claim only stamped claimedById). Without this the project views would
 * count the settlement for one ref and the debt for another.
 *
 * The representative ref is the alias that is a member of the project when
 * there is one (so results still line up with the project's participant list),
 * otherwise the canonical (user) ref. A person's split rows on one expense are
 * merged by summing their shares; a settlement that becomes a self-payment is
 * dropped. Returns the input untouched, without a DB read, when no shadow ref
 * appears in the ledger.
 */
export async function canonicalizeProjectLedger<
	T extends LedgerTx,
	S extends LedgerSettlement,
>(
	db: PrismaClient | Prisma.TransactionClient,
	projectId: string,
	transactions: T[],
	settlements: S[],
): Promise<{ transactions: T[]; settlements: S[] }> {
	const refs: ParticipantRef[] = [];
	for (const tx of transactions) {
		refs.push({ participantType: tx.paidByType, participantId: tx.paidById });
		for (const sp of tx.splitParticipants) {
			refs.push({
				participantType: sp.participantType,
				participantId: sp.participantId,
			});
		}
	}
	for (const s of settlements) {
		refs.push(
			{ participantType: s.fromParticipantType, participantId: s.fromParticipantId },
			{ participantType: s.toParticipantType, participantId: s.toParticipantId },
		);
	}

	// Aliases only ever pair a shadow with a user: no shadow, nothing to merge.
	if (!refs.some((r) => r.participantType === "shadow")) {
		return { transactions, settlements };
	}

	const prisma = db as PrismaClient;
	const members: ParticipantRef[] = await prisma.projectParticipant.findMany({
		where: { projectId },
		select: { participantType: true, participantId: true },
	});

	const { canonicalKey } = await resolveClaimAliases(db, [...refs, ...members]);
	const representative = new Map<string, ParticipantRef>();
	for (const m of members) {
		const ck = canonicalKey(m);
		if (!representative.has(ck)) {
			representative.set(ck, {
				participantType: m.participantType,
				participantId: m.participantId,
			});
		}
	}
	const rep = (r: ParticipantRef): ParticipantRef => {
		const ck = canonicalKey(r);
		return representative.get(ck) ?? parseKey(ck);
	};

	const outTxs = transactions.map((tx) => {
		const payer = rep({ participantType: tx.paidByType, participantId: tx.paidById });
		const merged = new Map<string, T["splitParticipants"][number]>();
		for (const sp of tx.splitParticipants) {
			const r = rep({
				participantType: sp.participantType,
				participantId: sp.participantId,
			});
			const k = key(r);
			const existing = merged.get(k);
			merged.set(k, {
				...sp,
				participantType: r.participantType,
				participantId: r.participantId,
				shareAmount: existing
					? Number(existing.shareAmount.toString()) +
						Number(sp.shareAmount.toString())
					: sp.shareAmount,
			});
		}
		return {
			...tx,
			paidByType: payer.participantType,
			paidById: payer.participantId,
			splitParticipants: [...merged.values()],
		};
	});

	const outSettlements: S[] = [];
	for (const s of settlements) {
		const from = rep({
			participantType: s.fromParticipantType,
			participantId: s.fromParticipantId,
		});
		const to = rep({
			participantType: s.toParticipantType,
			participantId: s.toParticipantId,
		});
		if (key(from) === key(to)) continue;
		outSettlements.push({
			...s,
			fromParticipantType: from.participantType,
			fromParticipantId: from.participantId,
			toParticipantType: to.participantType,
			toParticipantId: to.participantId,
		});
	}

	return { transactions: outTxs, settlements: outSettlements };
}

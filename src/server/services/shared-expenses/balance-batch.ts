/**
 * Balances between one person and many counterparts at once (the People
 * list, Owed to you), split from balance.ts. Same rules as computeBalance.
 */
import { toMinor } from "~/server/services/envelope/units";
import { countsFor } from "~/server/services/payments/ledger";
import type { Prisma, PrismaClient } from "~prisma";
import {
	BALANCE_SETTLEMENT_STATUSES,
	type BalanceOptions,
	type BalanceResult,
	balanceOf,
	COUNTED_SHARE,
	projectScopeWhere,
	settlementSide,
} from "./balance";
import { resolveClaimAliases } from "./identity";
import type { ParticipantRef } from "./types";

/**
 * Batch-compute balances between participantA and multiple counterparts, as
 * A sees them (the viewer is A unless `viewer` says otherwise: the project
 * cards show A's balances to whoever opens them, and a pending payment counts
 * only for the person who recorded it, so `null` or a third person never
 * counts one, as in computeBalance). Uses 4 queries total instead of 4 per
 * counterpart (4N → 4).
 */
export async function computeBalanceBatch(
	db: PrismaClient | Prisma.TransactionClient,
	participantA: ParticipantRef,
	counterparts: ParticipantRef[],
	opts?: Pick<BalanceOptions, "projectScope"> & {
		viewer?: ParticipantRef | null;
	},
): Promise<BalanceResult[]> {
	if (counterparts.length === 0) return [];

	const prisma = db as PrismaClient;
	const key = (type: string, id: string) => `${type}:${id}`;

	// Project scope fragment, applied identically to settlements and to the
	// nested transaction filter of the split queries (see projectScopeWhere).
	const projectWhere = projectScopeWhere({ projectScope: opts?.projectScope });

	// Expand A and every counterpart into their claim-alias refs so a claimed
	// shadow and its claiming user are summed together (edge-case 8 fix).
	const viewer = opts?.viewer === undefined ? participantA : opts.viewer;
	const { aliasesByKey, canonicalKey } = await resolveClaimAliases(prisma, [
		participantA,
		...counterparts,
		...(viewer ? [viewer] : []),
	]);
	// "" matches no canonical key: nobody is the viewer, so no pending row counts.
	const viewerKey = viewer ? canonicalKey(viewer) : "";
	const aRefs = aliasesByKey.get(
		key(participantA.participantType, participantA.participantId),
	) ?? [participantA];
	const aCanonical = canonicalKey(participantA);
	const aKeySet = new Set(
		aRefs.map((r) => key(r.participantType, r.participantId)),
	);

	// Collect the union of all counterpart alias refs (excluding any that
	// resolve to A itself, those are self, no balance).
	const counterpartRefs: ParticipantRef[] = [];
	const seen = new Set<string>();
	for (const c of counterparts) {
		if (canonicalKey(c) === aCanonical) continue;
		const aliases = aliasesByKey.get(
			key(c.participantType, c.participantId),
		) ?? [c];
		for (const r of aliases) {
			const k = key(r.participantType, r.participantId);
			if (aKeySet.has(k) || seen.has(k)) continue;
			seen.add(k);
			counterpartRefs.push(r);
		}
	}

	if (counterpartRefs.length === 0) {
		return counterparts.map(() => ({ byCurrency: {}, minorByCurrency: {} }));
	}

	const counterpartConditions = counterpartRefs.map((c) => ({
		participantType: c.participantType,
		participantId: c.participantId,
	}));
	const aPaidConds = aRefs.map((r) => ({
		paidByType: r.participantType,
		paidById: r.participantId,
	}));
	const aSplitConds = aRefs.map((r) => ({
		participantType: r.participantType,
		participantId: r.participantId,
	}));

	// 4 queries total (instead of 4 per counterpart)
	const [aPayedRows, bPayedRows, settlementsFromB, settlementsFromA] =
		await Promise.all([
			// All split participants where A paid and any counterpart owes
			prisma.splitParticipant.findMany({
				where: {
					...COUNTED_SHARE,
					OR: counterpartConditions,
					transaction: { OR: aPaidConds, ...projectWhere },
				},
				select: {
					transactionId: true,
					participantType: true,
					participantId: true,
					shareAmount: true,
					transaction: { select: { currency: true } },
				},
			}),
			// All split participants where any counterpart paid and A owes
			prisma.splitParticipant.findMany({
				where: {
					...COUNTED_SHARE,
					OR: aSplitConds,
					transaction: {
						OR: counterpartConditions.map((c) => ({
							paidByType: c.participantType,
							paidById: c.participantId,
						})),
						...projectWhere,
					},
				},
				select: {
					transactionId: true,
					participantType: true,
					participantId: true,
					shareAmount: true,
					transaction: {
						select: {
							currency: true,
							paidByType: true,
							paidById: true,
						},
					},
				},
			}),
			// All finalized or proposed (optimistic) settlements from any counterpart to A
			prisma.settlement.findMany({
				where: {
					OR: counterpartConditions.flatMap((c) =>
						aRefs.map((a) => ({
							fromParticipantType: c.participantType,
							fromParticipantId: c.participantId,
							toParticipantType: a.participantType,
							toParticipantId: a.participantId,
						})),
					),
					status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
					...projectWhere,
				},
				select: {
					id: true,
					fromParticipantType: true,
					fromParticipantId: true,
					toParticipantType: true,
					toParticipantId: true,
					amount: true,
					currency: true,
					status: true,
					confirmedByPayer: true,
					confirmedByPayee: true,
				},
			}),
			// All finalized or proposed (optimistic) settlements from A to any counterpart
			prisma.settlement.findMany({
				where: {
					OR: counterpartConditions.flatMap((c) =>
						aRefs.map((a) => ({
							fromParticipantType: a.participantType,
							fromParticipantId: a.participantId,
							toParticipantType: c.participantType,
							toParticipantId: c.participantId,
						})),
					),
					status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
					...projectWhere,
				},
				select: {
					id: true,
					fromParticipantType: true,
					fromParticipantId: true,
					toParticipantType: true,
					toParticipantId: true,
					amount: true,
					currency: true,
					status: true,
					confirmedByPayer: true,
					confirmedByPayee: true,
				},
			}),
		]);

	// Build per-counterpart balance maps, keyed by CANONICAL identity so
	// pre-claim shadow rows and post-claim user rows accumulate together.
	// Minor units only: the major-unit numbers are derived at the end (balanceOf).
	const minorMap = new Map<string, Record<string, number>>();

	const add = (
		k: string,
		currency: string,
		value: { toString(): string },
		sign: 1 | -1,
	) => {
		const m = minorMap.get(k) ?? {};
		minorMap.set(k, m);
		m[currency] =
			(m[currency] ?? 0) + sign * toMinor(value.toString(), currency);
	};

	// A person can appear on ONE transaction/settlement under multiple alias refs
	// (e.g. both `shadow:S` and `user:U` where U claimed S). Summing every
	// matching row would double-count. Dedupe per (row, canonical identity) so a
	// person is counted at most once per transaction/settlement, summing is only
	// valid ACROSS different transactions/settlements.
	const seenRows = new Set<string>();
	const once = (k: string): boolean => {
		if (seenRows.has(k)) return false;
		seenRows.add(k);
		return true;
	};

	// A paid, B owes -> positive. Counterpart (B) is the split participant; dedupe
	// per (transaction, canonical B).
	for (const row of aPayedRows) {
		const cKey = canonicalKey({
			participantType: row.participantType,
			participantId: row.participantId,
		});
		if (!once(`sp+|${row.transactionId}|${cKey}`)) continue;
		add(cKey, row.transaction.currency, row.shareAmount, 1);
	}

	// B paid, A owes -> negative. Bucket by the payer (counterpart); the counted
	// value is A's own share. Dedupe per (transaction, canonical payer, canonical A).
	for (const row of bPayedRows) {
		const payerKey = canonicalKey({
			participantType: row.transaction.paidByType,
			participantId: row.transaction.paidById,
		});
		const aKey = canonicalKey({
			participantType: row.participantType,
			participantId: row.participantId,
		});
		if (!once(`sp-|${row.transactionId}|${payerKey}|${aKey}`)) continue;
		add(payerKey, row.transaction.currency, row.shareAmount, -1);
	}

	// Settlements from B to A -> subtract. Dedupe per (settlement, canonical from, to).
	for (const row of settlementsFromB) {
		const fromKey = canonicalKey({
			participantType: row.fromParticipantType,
			participantId: row.fromParticipantId,
		});
		const toKey = canonicalKey({
			participantType: row.toParticipantType,
			participantId: row.toParticipantId,
		});
		// With A as the viewer A is the payee: a pending row from B is B's
		// claim, not counted (I5).
		if (!countsFor(row, settlementSide(row, viewerKey, canonicalKey)))
			continue;
		if (!once(`st|${row.id}|${fromKey}|${toKey}`)) continue;
		add(fromKey, row.currency, row.amount, -1);
	}

	// Settlements from A to B -> add. Dedupe per (settlement, canonical from, to).
	for (const row of settlementsFromA) {
		const fromKey = canonicalKey({
			participantType: row.fromParticipantType,
			participantId: row.fromParticipantId,
		});
		const toKey = canonicalKey({
			participantType: row.toParticipantType,
			participantId: row.toParticipantId,
		});
		if (!countsFor(row, settlementSide(row, viewerKey, canonicalKey)))
			continue;
		if (!once(`st|${row.id}|${fromKey}|${toKey}`)) continue;
		add(toKey, row.currency, row.amount, 1);
	}

	// Map results back to counterparts in order (via each one's canonical key).
	return counterparts.map((c) => {
		if (canonicalKey(c) === aCanonical)
			return { byCurrency: {}, minorByCurrency: {} };
		return balanceOf(minorMap.get(canonicalKey(c)) ?? {});
	});
}

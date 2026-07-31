import type { Prisma, PrismaClient } from "~prisma";
import { resolveClaimAliases } from "./identity";
import type { ParticipantRef } from "./types";
import { sameParticipant } from "./types";

interface BalanceResult {
	/** Per-currency net balances. Positive means participantB owes participantA. */
	byCurrency: Record<string, number>;
}

/**
 * Settlement statuses that count toward balance calculations.
 * PROPOSED settlements are included for optimistic balance display —
 * balances update immediately when a settlement is proposed.
 */
const BALANCE_SETTLEMENT_STATUSES = ["FINALIZED", "PROPOSED"] as const;

/** Remove currencies with effectively zero balance (floating point tolerance). */
function pruneZeroBalances(byCurrency: Record<string, number>) {
	for (const currency of Object.keys(byCurrency)) {
		if (Math.abs(byCurrency[currency]!) < 0.00000001) {
			delete byCurrency[currency];
		}
	}
}

/**
 * Compute the net balance between two participants across all shared
 * transactions and settlements.
 *
 * Formula:
 *   For each currency:
 *     SUM(transactions where A paid and B is a split participant -> B's shareAmount)
 *   - SUM(transactions where B paid and A is a split participant -> A's shareAmount)
 *   - SUM(finalized settlements from B to A)
 *   + SUM(finalized settlements from A to B)
 *
 * Positive result means B owes A in that currency.
 */
export async function computeBalance(
	db: PrismaClient | Prisma.TransactionClient,
	participantA: ParticipantRef,
	participantB: ParticipantRef,
): Promise<BalanceResult> {
	if (sameParticipant(participantA, participantB)) {
		return { byCurrency: {} };
	}

	const prisma = db as PrismaClient;

	// Expand each ref into all of its equivalent refs so a claimed shadow and
	// its claiming user are treated as the same party — pre-claim and post-claim
	// history is summed rather than tracked separately (edge-case 8 fix).
	const { aliasesByKey } = await resolveClaimAliases(prisma, [
		participantA,
		participantB,
	]);
	const aRefs = aliasesByKey.get(
		`${participantA.participantType}:${participantA.participantId}`,
	) ?? [participantA];
	const bRefs = aliasesByKey.get(
		`${participantB.participantType}:${participantB.participantId}`,
	) ?? [participantB];

	// If the two parties resolve to the same identity (e.g. B is a shadow the
	// user A claimed), there is no cross-party balance to compute.
	const aKeys = new Set(
		aRefs.map((r) => `${r.participantType}:${r.participantId}`),
	);
	if (bRefs.some((r) => aKeys.has(`${r.participantType}:${r.participantId}`))) {
		return { byCurrency: {} };
	}

	const orConds = (refs: ParticipantRef[]) =>
		refs.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
		}));
	const paidByConds = (refs: ParticipantRef[]) =>
		refs.map((r) => ({
			paidByType: r.participantType,
			paidById: r.participantId,
		}));

	// Find transactions where A paid and B is a split participant
	const aPayedBOwes = await prisma.splitParticipant.findMany({
		where: {
			OR: orConds(bRefs),
			transaction: { OR: paidByConds(aRefs) },
		},
		select: {
			shareAmount: true,
			transaction: {
				select: { currency: true },
			},
		},
	});

	// Find transactions where B paid and A is a split participant
	const bPayedAOwes = await prisma.splitParticipant.findMany({
		where: {
			OR: orConds(aRefs),
			transaction: { OR: paidByConds(bRefs) },
		},
		select: {
			shareAmount: true,
			transaction: {
				select: { currency: true },
			},
		},
	});

	// Find finalized or proposed (optimistic) settlements from B to A
	const settlementsBA = await prisma.settlement.findMany({
		where: {
			OR: bRefs.flatMap((from) =>
				aRefs.map((to) => ({
					fromParticipantType: from.participantType,
					fromParticipantId: from.participantId,
					toParticipantType: to.participantType,
					toParticipantId: to.participantId,
				})),
			),
			status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
		},
		select: {
			amount: true,
			currency: true,
		},
	});

	// Find finalized or proposed (optimistic) settlements from A to B
	const settlementsAB = await prisma.settlement.findMany({
		where: {
			OR: aRefs.flatMap((from) =>
				bRefs.map((to) => ({
					fromParticipantType: from.participantType,
					fromParticipantId: from.participantId,
					toParticipantType: to.participantType,
					toParticipantId: to.participantId,
				})),
			),
			status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
		},
		select: {
			amount: true,
			currency: true,
		},
	});

	const byCurrency: Record<string, number> = {};

	const add = (currency: string, value: number) => {
		byCurrency[currency] = (byCurrency[currency] ?? 0) + value;
	};

	// A paid, B owes -> positive (B owes A)
	for (const row of aPayedBOwes) {
		add(row.transaction.currency, Number(row.shareAmount));
	}

	// B paid, A owes -> negative (A owes B, so B is owed less)
	for (const row of bPayedAOwes) {
		add(row.transaction.currency, -Number(row.shareAmount));
	}

	// Settlements from B to A reduce what B owes A -> subtract
	for (const row of settlementsBA) {
		add(row.currency, -Number(row.amount));
	}

	// Settlements from A to B increase what B owes A -> add
	for (const row of settlementsAB) {
		add(row.currency, Number(row.amount));
	}

	pruneZeroBalances(byCurrency);
	return { byCurrency };
}

/**
 * Batch-compute balances between participantA and multiple counterparts.
 * Uses 4 queries total instead of 4 per counterpart (4N → 4).
 */
export async function computeBalanceBatch(
	db: PrismaClient | Prisma.TransactionClient,
	participantA: ParticipantRef,
	counterparts: ParticipantRef[],
): Promise<BalanceResult[]> {
	if (counterparts.length === 0) return [];

	const prisma = db as PrismaClient;
	const key = (type: string, id: string) => `${type}:${id}`;

	// Expand A and every counterpart into their claim-alias refs so a claimed
	// shadow and its claiming user are summed together (edge-case 8 fix).
	const { aliasesByKey, canonicalKey } = await resolveClaimAliases(prisma, [
		participantA,
		...counterparts,
	]);
	const aRefs = aliasesByKey.get(
		key(participantA.participantType, participantA.participantId),
	) ?? [participantA];
	const aCanonical = canonicalKey(participantA);
	const aKeySet = new Set(aRefs.map((r) => key(r.participantType, r.participantId)));

	// Collect the union of all counterpart alias refs (excluding any that
	// resolve to A itself — those are self, no balance).
	const counterpartRefs: ParticipantRef[] = [];
	const seen = new Set<string>();
	for (const c of counterparts) {
		if (canonicalKey(c) === aCanonical) continue;
		const aliases = aliasesByKey.get(key(c.participantType, c.participantId)) ?? [c];
		for (const r of aliases) {
			const k = key(r.participantType, r.participantId);
			if (aKeySet.has(k) || seen.has(k)) continue;
			seen.add(k);
			counterpartRefs.push(r);
		}
	}

	if (counterpartRefs.length === 0) {
		return counterparts.map(() => ({ byCurrency: {} }));
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
					OR: counterpartConditions,
					transaction: { OR: aPaidConds },
				},
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
					transaction: { select: { currency: true } },
				},
			}),
			// All split participants where any counterpart paid and A owes
			prisma.splitParticipant.findMany({
				where: {
					OR: aSplitConds,
					transaction: {
						OR: counterpartConditions.map((c) => ({
							paidByType: c.participantType,
							paidById: c.participantId,
						})),
					},
				},
				select: {
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
				},
				select: {
					fromParticipantType: true,
					fromParticipantId: true,
					amount: true,
					currency: true,
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
				},
				select: {
					toParticipantType: true,
					toParticipantId: true,
					amount: true,
					currency: true,
				},
			}),
		]);

	// Build per-counterpart balance maps, keyed by CANONICAL identity so
	// pre-claim shadow rows and post-claim user rows accumulate together.
	const balanceMap = new Map<string, Record<string, number>>();

	const getOrCreate = (k: string) => {
		let m = balanceMap.get(k);
		if (!m) {
			m = {};
			balanceMap.set(k, m);
		}
		return m;
	};

	const add = (m: Record<string, number>, currency: string, value: number) => {
		m[currency] = (m[currency] ?? 0) + value;
	};

	// A paid, B owes -> positive
	for (const row of aPayedRows) {
		const m = getOrCreate(
			canonicalKey({
				participantType: row.participantType,
				participantId: row.participantId,
			}),
		);
		add(m, row.transaction.currency, Number(row.shareAmount));
	}

	// B paid, A owes -> negative
	for (const row of bPayedRows) {
		const m = getOrCreate(
			canonicalKey({
				participantType: row.transaction.paidByType,
				participantId: row.transaction.paidById,
			}),
		);
		add(m, row.transaction.currency, -Number(row.shareAmount));
	}

	// Settlements from B to A -> subtract
	for (const row of settlementsFromB) {
		const m = getOrCreate(
			canonicalKey({
				participantType: row.fromParticipantType,
				participantId: row.fromParticipantId,
			}),
		);
		add(m, row.currency, -Number(row.amount));
	}

	// Settlements from A to B -> add
	for (const row of settlementsFromA) {
		const m = getOrCreate(
			canonicalKey({
				participantType: row.toParticipantType,
				participantId: row.toParticipantId,
			}),
		);
		add(m, row.currency, Number(row.amount));
	}

	// Map results back to counterparts in order (via each one's canonical key).
	return counterparts.map((c) => {
		if (canonicalKey(c) === aCanonical) return { byCurrency: {} };
		const byCurrency = { ...(balanceMap.get(canonicalKey(c)) ?? {}) };
		pruneZeroBalances(byCurrency);
		return { byCurrency };
	});
}

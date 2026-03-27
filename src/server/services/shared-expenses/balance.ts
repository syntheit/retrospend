import type { Prisma, PrismaClient } from "~prisma";
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

	// Find transactions where A paid and B is a split participant
	const aPayedBOwes = await prisma.splitParticipant.findMany({
		where: {
			participantType: participantB.participantType,
			participantId: participantB.participantId,
			transaction: {
				paidByType: participantA.participantType,
				paidById: participantA.participantId,
			},
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
			participantType: participantA.participantType,
			participantId: participantA.participantId,
			transaction: {
				paidByType: participantB.participantType,
				paidById: participantB.participantId,
			},
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
			fromParticipantType: participantB.participantType,
			fromParticipantId: participantB.participantId,
			toParticipantType: participantA.participantType,
			toParticipantId: participantA.participantId,
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
			fromParticipantType: participantA.participantType,
			fromParticipantId: participantA.participantId,
			toParticipantType: participantB.participantType,
			toParticipantId: participantB.participantId,
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

	// Build OR conditions for all counterparts
	const counterpartConditions = counterparts
		.filter((c) => !sameParticipant(participantA, c))
		.map((c) => ({
			participantType: c.participantType,
			participantId: c.participantId,
		}));

	if (counterpartConditions.length === 0) {
		return counterparts.map(() => ({ byCurrency: {} }));
	}

	// 4 queries total (instead of 4 per counterpart)
	const [aPayedRows, bPayedRows, settlementsFromB, settlementsFromA] =
		await Promise.all([
			// All split participants where A paid and any counterpart owes
			prisma.splitParticipant.findMany({
				where: {
					OR: counterpartConditions,
					transaction: {
						paidByType: participantA.participantType,
						paidById: participantA.participantId,
					},
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
					participantType: participantA.participantType,
					participantId: participantA.participantId,
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
					OR: counterpartConditions.map((c) => ({
						fromParticipantType: c.participantType,
						fromParticipantId: c.participantId,
					})),
					toParticipantType: participantA.participantType,
					toParticipantId: participantA.participantId,
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
					fromParticipantType: participantA.participantType,
					fromParticipantId: participantA.participantId,
					OR: counterpartConditions.map((c) => ({
						toParticipantType: c.participantType,
						toParticipantId: c.participantId,
					})),
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

	// Build per-counterpart balance maps
	const key = (type: string, id: string) => `${type}:${id}`;
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
		const m = getOrCreate(key(row.participantType, row.participantId));
		add(m, row.transaction.currency, Number(row.shareAmount));
	}

	// B paid, A owes -> negative
	for (const row of bPayedRows) {
		const m = getOrCreate(
			key(row.transaction.paidByType, row.transaction.paidById),
		);
		add(m, row.transaction.currency, -Number(row.shareAmount));
	}

	// Settlements from B to A -> subtract
	for (const row of settlementsFromB) {
		const m = getOrCreate(
			key(row.fromParticipantType, row.fromParticipantId),
		);
		add(m, row.currency, -Number(row.amount));
	}

	// Settlements from A to B -> add
	for (const row of settlementsFromA) {
		const m = getOrCreate(key(row.toParticipantType, row.toParticipantId));
		add(m, row.currency, Number(row.amount));
	}

	// Map results back to counterparts in order
	return counterparts.map((c) => {
		if (sameParticipant(participantA, c)) return { byCurrency: {} };
		const byCurrency = { ...(balanceMap.get(key(c.participantType, c.participantId)) ?? {}) };
		pruneZeroBalances(byCurrency);
		return { byCurrency };
	});
}

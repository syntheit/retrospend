import { BALANCE_SETTLEMENT_STATUSES } from "~/server/services/shared-expenses/balance";
import { canonicalizeProjectLedger } from "~/server/services/shared-expenses/identity";
import type { Prisma, PrismaClient } from "~prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * A project's expenses (with split rows) and counted payments
 * (BALANCE_SETTLEMENT_STATUSES), optionally scoped to one billing period,
 * with each person's claim aliases merged into one ref.
 *
 * With a period, the settlement plan has always set the period's expenses
 * against every payment in the project; `paymentsOfPeriodOnly` (the
 * summary) keeps only payments recorded against that period instead.
 *
 * Payments are filtered by projectId (they are project-scoped), so payments
 * made for other projects or outside any project never bleed in. Every group
 * figure of a project (settlement plan, member balances, the summary) reads
 * this one ledger, so they cannot disagree about what counts.
 */
export async function fetchProjectLedger(
	db: Db,
	projectId: string,
	periodId?: string,
	options: { paymentsOfPeriodOnly?: boolean } = {},
) {
	const prisma = db as PrismaClient;
	const transactions = await prisma.sharedTransaction.findMany({
		where: {
			projectId,
			...(periodId ? { billingPeriodId: periodId } : {}),
		},
		select: {
			currency: true,
			amount: true,
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
				},
			},
		},
	});

	if (transactions.length === 0) {
		return { transactions: [], settlements: [] };
	}

	const people = new Set<string>();
	for (const tx of transactions) {
		people.add(`${tx.paidByType}:${tx.paidById}`);
		for (const sp of tx.splitParticipants) {
			people.add(`${sp.participantType}:${sp.participantId}`);
		}
	}
	// One person alone owes nobody, so their payments cannot matter.
	if (people.size < 2) {
		return { transactions, settlements: [] };
	}

	const settlements = await prisma.settlement.findMany({
		where: {
			projectId,
			status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
			...(periodId && options.paymentsOfPeriodOnly
				? { billingPeriodId: periodId }
				: {}),
		},
		select: {
			fromParticipantType: true,
			fromParticipantId: true,
			toParticipantType: true,
			toParticipantId: true,
			amount: true,
			currency: true,
		},
	});

	// One ref per person: claimed shadows and their users are merged, matching
	// the alias-aware pairwise balances that settle-ups are recorded against.
	return canonicalizeProjectLedger(db, projectId, transactions, settlements);
}

export type ProjectLedger = Awaited<ReturnType<typeof fetchProjectLedger>>;

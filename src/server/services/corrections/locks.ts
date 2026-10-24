/**
 * Settlement locks (MONEY-MOVES 1.11): a split is locked once a payment
 * brought its scope to zero after the split's date. Locked splits cannot be
 * edited; the creator corrects them and everyone else asks to fix.
 *
 * Called after a payment turns final (recorded by the payee, or confirmed) and
 * after a forgive. The decision reads only what the caller may see: a
 * balance it cannot see counts as open, so the worst case is a split left
 * unlocked, never a lock on money that is still owed. The lock is written by
 * `lock_settled_splits` (the other person's split is theirs to write) and
 * released by a trigger when the payment is deleted or stops being final.
 *
 * Period close locks splits on its own (billing-period); those carry no
 * payment id and are not touched here.
 */
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import {
	type ParticipantRef,
	sameParticipant,
} from "~/server/services/shared-expenses/types";
import type { Prisma } from "~prisma";
import type { PairEvent } from "../payments/ledger";

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;

/**
 * True when every currency of the scope's balance is zero as of `day`,
 * counting only payments both sides have (a pending one settles nothing).
 */
export function settledAsOf(
	events: readonly PairEvent[],
	scope: string | null,
	day: string,
): boolean {
	const totals = new Map<string, number>();
	for (const e of events) {
		if (e.scope !== scope || e.date > day || e.pending) continue;
		totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.minor);
	}
	return [...totals.values()].every((minor) => minor === 0);
}

const refOf = (
	participantType: ParticipantRef["participantType"],
	participantId: string,
): ParticipantRef => ({ participantType, participantId });

/** A split `paid` paid with `other` on it. */
const paidFor = (paid: ParticipantRef, other: ParticipantRef) => ({
	paidByType: paid.participantType,
	paidById: paid.participantId,
	splitParticipants: {
		some: {
			participantType: other.participantType,
			participantId: other.participantId,
		},
	},
});

/** Locks the splits the final payment `paymentId` settled; returns how many. */
export async function lockSettledSplits(
	tx: Tx,
	me: ParticipantRef,
	paymentId: string,
): Promise<number> {
	const header = await tx.payment.findUnique({
		where: { id: paymentId },
		include: { settlements: { select: { projectId: true } } },
	});
	if (!header || header.status !== "FINALIZED") return 0;
	const payer = refOf(header.payerType, header.payerId);
	const payee = refOf(header.payeeType, header.payeeId);
	const scopes = [...new Set(header.settlements.map((s) => s.projectId))];
	if (scopes.length === 0) return 0;
	const day = header.paidOn.toISOString().slice(0, 10);
	const candidates = await tx.sharedTransaction.findMany({
		where: {
			isLocked: false,
			correctsId: null,
			date: { lt: new Date(header.paidOn.getTime() + DAY_MS) },
			AND: [
				{ OR: scopes.map((projectId) => ({ projectId })) },
				{ OR: [paidFor(payer, payee), paidFor(payee, payer)] },
			],
		},
		select: {
			id: true,
			projectId: true,
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

	const ledgers = new Map<string, Promise<PairEvent[]>>();
	const ledgerOf = (a: ParticipantRef, b: ParticipantRef) => {
		const key = `${a.participantType}:${a.participantId}|${b.participantType}:${b.participantId}`;
		let ledger = ledgers.get(key);
		if (!ledger) {
			ledger = computePairLedger(tx, a, b, { viewer: me });
			ledgers.set(key, ledger);
		}
		return ledger;
	};

	const settled: string[] = [];
	for (const t of candidates) {
		const paidBy = refOf(t.paidByType, t.paidById);
		const others = t.splitParticipants
			.map((p) => refOf(p.participantType, p.participantId))
			.filter(
				(p, i) =>
					!sameParticipant(p, paidBy) &&
					Number(t.splitParticipants[i]?.shareAmount ?? 0) !== 0,
			);
		let all = true;
		for (const other of others) {
			if (!settledAsOf(await ledgerOf(paidBy, other), t.projectId, day)) {
				all = false;
				break;
			}
		}
		if (all) settled.push(t.id);
	}
	if (settled.length === 0) return 0;
	const [{ locked }] = await tx.$queryRaw<[{ locked: number }]>`
		SELECT lock_settled_splits(${paymentId}, ${settled}::text[]) AS locked`;
	return Number(locked);
}

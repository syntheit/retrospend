import { toMinor } from "~/server/services/envelope/units";
import { countsFor, type PairEvent } from "~/server/services/payments/ledger";
import type { ParticipantType, Prisma, PrismaClient } from "~prisma";
import { resolveClaimAliases } from "./identity";
import type { ParticipantRef } from "./types";
import { sameParticipant } from "./types";

export interface BalanceResult {
	/** Per-currency net balances. Positive means participantB owes participantA. */
	byCurrency: Record<string, number>;
}

/**
 * Optional scoping for a balance computation.
 *
 * - `projectScope` omitted or `undefined`: GLOBAL. No project filter is applied
 *   to settlements or transactions (the historical default; every existing
 *   caller keeps identical behavior).
 * - `projectScope` a string: restrict BOTH settlements and transactions to that
 *   projectId.
 * - `projectScope` null: restrict BOTH settlements and transactions to
 *   projectId IS NULL (direct / project-less rows only).
 */
export interface BalanceOptions {
	projectScope?: string | null;
	/**
	 * Whose view the balance is (MONEY-MOVES rule 2, I5). A pending payment
	 * counts only for the person who recorded it; the other side sees it as a
	 * claim until they confirm. Defaults to participantA: "the balance as A
	 * sees it". Pass the current user when A is someone else (a payment
	 * received is computed from the payer's side).
	 */
	viewer?: ParticipantRef;
}

/**
 * Build a `projectId` where-fragment from a balance scope. Returns an empty
 * object when the scope is GLOBAL (undefined) so no filter is applied; returns
 * `{ projectId: <scope> }` (including `{ projectId: null }`) otherwise.
 *
 * Applied identically to settlements (top-level) and to the nested `transaction`
 * filter of the split queries, so a scoped balance sees the same projectId on
 * both sides of the ledger.
 */
export function projectScopeWhere(opts?: BalanceOptions): {
	projectId?: string | null;
} {
	if (!opts || opts.projectScope === undefined) return {};
	return { projectId: opts.projectScope };
}

/**
 * Settlement statuses a balance query loads. Pairwise balances here then
 * apply the viewer rule (countsFor in payments/ledger.ts): FINALIZED counts
 * for everyone, PROPOSED only for the person who recorded it, so a payer
 * sees their payment at once and the payee only once they confirm (I5).
 *
 * Group views that are nobody's pair (project summaries, billing-period
 * checks, exports) still count both statuses for everyone; they move to the
 * viewer rule with their own tracks.
 */
export const BALANCE_SETTLEMENT_STATUSES = ["FINALIZED", "PROPOSED"] as const;

/** Remove currencies with effectively zero balance (floating point tolerance). */
export function pruneZeroBalances(byCurrency: Record<string, number>) {
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
	opts?: BalanceOptions,
): Promise<BalanceResult> {
	const { byCurrency } = await computePairBalance(
		db,
		participantA,
		participantB,
		opts,
	);
	return { byCurrency };
}

/**
 * Per-scope breakdown of the pairwise balance between A and B: one entry per
 * projectId the pair has history in (`null` = direct / project-less rows).
 * Each entry uses the same sign convention as {@link computeBalance} (positive
 * = B owes A) and already nets that scope's settlements, so summing every
 * entry gives exactly the GLOBAL balance. Scopes whose balance is zero in
 * every currency are omitted.
 *
 * Used to allocate a payment entered in the global (People) view across the
 * per-project balances, and to show settlement-aware per-project pills.
 */
export async function computeBalanceByProject(
	db: PrismaClient | Prisma.TransactionClient,
	participantA: ParticipantRef,
	participantB: ParticipantRef,
	opts?: Pick<BalanceOptions, "viewer">,
): Promise<Map<string | null, Record<string, number>>> {
	const { byProject } = await computePairBalance(
		db,
		participantA,
		participantB,
		{ viewer: opts?.viewer },
	);
	return byProject;
}

/**
 * {@link computeBalance} (global) plus its per-scope breakdown (see
 * {@link computeBalanceByProject}) from a single set of queries.
 */
export async function computeBalanceWithProjects(
	db: PrismaClient | Prisma.TransactionClient,
	participantA: ParticipantRef,
	participantB: ParticipantRef,
	opts?: Pick<BalanceOptions, "viewer">,
): Promise<PairBalance> {
	return computePairBalance(db, participantA, participantB, {
		viewer: opts?.viewer,
	});
}

/**
 * The pair's history as minor-unit events from A's side, for the payments
 * engine (oldest open debt, "Settled since", allocation). Same rows and
 * viewer rule as computeBalance.
 */
export async function computePairLedger(
	db: PrismaClient | Prisma.TransactionClient,
	participantA: ParticipantRef,
	participantB: ParticipantRef,
	opts?: BalanceOptions,
): Promise<PairEvent[]> {
	const { events } = await computePairBalance(
		db,
		participantA,
		participantB,
		opts,
	);
	return events;
}

export interface PairBalance {
	byCurrency: Record<string, number>;
	byProject: Map<string | null, Record<string, number>>;
	/** The same history in minor units, from A's side (see payments/ledger.ts). */
	events: PairEvent[];
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Fields of a settlement row the pair queries load. */
const SETTLEMENT_SELECT = {
	id: true,
	fromParticipantType: true,
	fromParticipantId: true,
	toParticipantType: true,
	toParticipantId: true,
	amount: true,
	currency: true,
	projectId: true,
	status: true,
	confirmedByPayer: true,
	confirmedByPayee: true,
	initiatedAt: true,
	payment: { select: { paidOn: true } },
} as const;

async function computePairBalance(
	db: PrismaClient | Prisma.TransactionClient,
	participantA: ParticipantRef,
	participantB: ParticipantRef,
	opts?: BalanceOptions,
): Promise<PairBalance> {
	if (sameParticipant(participantA, participantB)) {
		return { byCurrency: {}, byProject: new Map(), events: [] };
	}
	const viewer = opts?.viewer ?? participantA;

	const prisma = db as PrismaClient;

	// Project scope fragment, applied identically to settlements and to the
	// nested transaction filter of the split queries (see projectScopeWhere).
	const projectWhere = projectScopeWhere(opts);

	// Expand each ref into all of its equivalent refs so a claimed shadow and
	// its claiming user are treated as the same party, pre-claim and post-claim
	// history is summed rather than tracked separately (edge-case 8 fix).
	const { aliasesByKey, canonicalKey } = await resolveClaimAliases(prisma, [
		participantA,
		participantB,
		viewer,
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
		return { byCurrency: {}, byProject: new Map(), events: [] };
	}
	const viewerKey = canonicalKey(viewer);

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
			transaction: { OR: paidByConds(aRefs), ...projectWhere },
		},
		select: {
			transactionId: true,
			participantType: true,
			participantId: true,
			shareAmount: true,
			transaction: {
				select: { currency: true, projectId: true, date: true },
			},
		},
	});

	// Find transactions where B paid and A is a split participant
	const bPayedAOwes = await prisma.splitParticipant.findMany({
		where: {
			OR: orConds(aRefs),
			transaction: { OR: paidByConds(bRefs), ...projectWhere },
		},
		select: {
			transactionId: true,
			participantType: true,
			participantId: true,
			shareAmount: true,
			transaction: {
				select: { currency: true, projectId: true, date: true },
			},
		},
	});

	// Settlements from B to A (each then filtered by the viewer rule)
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
			...projectWhere,
		},
		select: SETTLEMENT_SELECT,
	});

	// Settlements from A to B (each then filtered by the viewer rule)
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
			...projectWhere,
		},
		select: SETTLEMENT_SELECT,
	});

	const byCurrency: Record<string, number> = {};
	const byProject = new Map<string | null, Record<string, number>>();
	const events: PairEvent[] = [];

	const add = (
		currency: string,
		value: { toString(): string },
		sign: 1 | -1,
		projectId: string | null | undefined,
		event: Pick<PairEvent, "date" | "kind" | "pending">,
	) => {
		const amount = sign * Number(value);
		byCurrency[currency] = (byCurrency[currency] ?? 0) + amount;
		const scope = projectId ?? null;
		let bucket = byProject.get(scope);
		if (!bucket) {
			bucket = {};
			byProject.set(scope, bucket);
		}
		bucket[currency] = (bucket[currency] ?? 0) + amount;
		events.push({
			...event,
			scope,
			currency,
			minor: sign * toMinor(value.toString(), currency),
		});
	};
	const shareEvent = (date: Date) => ({
		date: isoDate(date),
		kind: "share" as const,
	});

	// A person can appear on ONE transaction under multiple alias refs (e.g. both
	// `shadow:S` and `user:U` where U claimed S). Summing every matching split row
	// would double-count their share. Dedupe per (transactionId, canonical
	// identity of the split participant) so each person counts once per
	// transaction, summing is only valid ACROSS different transactions.
	const seenSplits = new Set<string>();
	const splitKey = (
		transactionId: string,
		participantType: ParticipantType,
		participantId: string,
	) => `${transactionId}|${canonicalKey({ participantType, participantId })}`;

	// A paid, B owes -> positive (B owes A)
	for (const row of aPayedBOwes) {
		const k = splitKey(
			row.transactionId,
			row.participantType,
			row.participantId,
		);
		if (seenSplits.has(k)) continue;
		seenSplits.add(k);
		add(
			row.transaction.currency,
			row.shareAmount,
			1,
			row.transaction.projectId,
			shareEvent(row.transaction.date),
		);
	}

	// B paid, A owes -> negative (A owes B, so B is owed less)
	for (const row of bPayedAOwes) {
		const k = splitKey(
			row.transactionId,
			row.participantType,
			row.participantId,
		);
		if (seenSplits.has(k)) continue;
		seenSplits.add(k);
		add(
			row.transaction.currency,
			row.shareAmount,
			-1,
			row.transaction.projectId,
			shareEvent(row.transaction.date),
		);
	}

	// Settlements can also match under multiple alias refs on both ends. Dedupe
	// per (settlement id, canonical from, canonical to) so each real settlement
	// counts once.
	const seenSettlements = new Set<string>();
	const settlementKey = (row: {
		id: string;
		fromParticipantType: ParticipantType;
		fromParticipantId: string;
		toParticipantType: ParticipantType;
		toParticipantId: string;
	}) =>
		`${row.id}|${canonicalKey({
			participantType: row.fromParticipantType,
			participantId: row.fromParticipantId,
		})}|${canonicalKey({
			participantType: row.toParticipantType,
			participantId: row.toParticipantId,
		})}`;

	const counted = (row: (typeof settlementsAB)[number]) =>
		countsFor(row, settlementSide(row, viewerKey, canonicalKey));
	const paymentEvent = (row: (typeof settlementsAB)[number]) => ({
		date: isoDate(row.payment?.paidOn ?? row.initiatedAt),
		kind: "payment" as const,
		pending: row.status === "PROPOSED",
	});

	// Settlements from B to A reduce what B owes A -> subtract
	for (const row of settlementsBA) {
		const k = settlementKey(row);
		if (seenSettlements.has(k) || !counted(row)) continue;
		seenSettlements.add(k);
		add(row.currency, row.amount, -1, row.projectId, paymentEvent(row));
	}

	// Settlements from A to B increase what B owes A -> add
	for (const row of settlementsAB) {
		const k = settlementKey(row);
		if (seenSettlements.has(k) || !counted(row)) continue;
		seenSettlements.add(k);
		add(row.currency, row.amount, 1, row.projectId, paymentEvent(row));
	}

	pruneZeroBalances(byCurrency);
	for (const [scope, bucket] of byProject) {
		pruneZeroBalances(bucket);
		if (Object.keys(bucket).length === 0) byProject.delete(scope);
	}
	return { byCurrency, byProject, events };
}

/** Which side of a settlement row the viewer is on (claim aliases count). */
function settlementSide(
	row: {
		fromParticipantType: ParticipantType;
		fromParticipantId: string;
		toParticipantType: ParticipantType;
		toParticipantId: string;
	},
	viewerKey: string,
	canonicalKey: (ref: ParticipantRef) => string,
): "from" | "to" | null {
	const from = canonicalKey({
		participantType: row.fromParticipantType,
		participantId: row.fromParticipantId,
	});
	if (from === viewerKey) return "from";
	const to = canonicalKey({
		participantType: row.toParticipantType,
		participantId: row.toParticipantId,
	});
	return to === viewerKey ? "to" : null;
}

import type { ParticipantType } from "~prisma";

// ── input types ───────────────────────────────────────────────────────────────

/** Minimal transaction shape needed for settlement plan computation. */
export interface TxForSettlement {
	currency: string;
	/** Full amount paid by the payer. Accepts Decimal or number. */
	amount: number | { toString(): string };
	paidByType: ParticipantType;
	paidById: string;
	splitParticipants: Array<{
		participantType: ParticipantType;
		participantId: string;
		/** This participant's share of the transaction. Accepts Decimal or number. */
		shareAmount: number | { toString(): string };
	}>;
}

/** Minimal settlement row. Only pass FINALIZED settlements. */
export interface SettlementForPlan {
	fromParticipantType: ParticipantType;
	fromParticipantId: string;
	toParticipantType: ParticipantType;
	toParticipantId: string;
	/** Settlement amount. Accepts Decimal or number. */
	amount: number | { toString(): string };
	currency: string;
}

// ── output types ──────────────────────────────────────────────────────────────

export interface ParticipantRef {
	participantType: ParticipantType;
	participantId: string;
}

export interface SettlementStep {
	from: ParticipantRef;
	to: ParticipantRef;
	/** Amount to pay, rounded to 2 decimal places. */
	amount: number;
	currency: string;
}

export interface ParticipantBalance {
	participant: ParticipantRef;
	/** Total transaction amounts physically paid by this participant. */
	totalPaid: number;
	/** Sum of all share obligations for this participant. */
	fairShare: number;
	/** totalPaid − fairShare (positive = creditor, negative = debtor). */
	netBalance: number;
}

export interface CurrencyBreakdown {
	plan: SettlementStep[];
	balances: ParticipantBalance[];
}

export interface SettlementPlanResult {
	byCurrency: Record<string, CurrencyBreakdown>;
	/** Number of unique participants across all currencies. */
	participantCount: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toNum(val: number | { toString(): string }): number {
	return typeof val === "number" ? val : Number(val.toString());
}

function pkey(type: string, id: string): string {
	return `${type}:${id}`;
}

/** Balances below this threshold (in absolute value) are treated as zero. */
const ZERO_TOLERANCE = 0.005;

// ── algorithm ─────────────────────────────────────────────────────────────────

/**
 * Compute an optimal greedy settlement plan for a set of shared transactions.
 *
 * Step 1: Group transactions by currency. Each currency is processed independently.
 *
 * Step 2: For each currency, compute net balance per participant:
 *   net = totalPaid − fairShare + settlementsOutgoing − settlementsIncoming
 *   Positive net = creditor (is owed money). Negative net = debtor (owes money).
 *
 * Step 3: Greedy settlement: repeatedly match the largest creditor with the
 *   largest debtor until all balances are within ZERO_TOLERANCE of zero.
 *
 * @param transactions  Transactions with their split participants. Must be
 *                      pre-filtered to the desired project/period scope.
 * @param existingSettlements  FINALIZED settlements between project participants.
 *                             These reduce the remaining balances before computing
 *                             the plan.
 */
export function computeSettlementPlan(
	transactions: TxForSettlement[],
	existingSettlements: SettlementForPlan[],
): SettlementPlanResult {
	// Step 1: collect currencies
	const currencies = new Set<string>();
	for (const tx of transactions) currencies.add(tx.currency);

	if (currencies.size === 0) {
		return { byCurrency: {}, participantCount: 0 };
	}

	const allParticipantKeys = new Set<string>();
	const byCurrency: Record<string, CurrencyBreakdown> = {};

	for (const currency of currencies) {
		const currencyTxns = transactions.filter((tx) => tx.currency === currency);

		// Step 2: accumulate paid / share totals per participant
		const paidMap = new Map<string, number>();
		const shareMap = new Map<string, number>();
		const refMap = new Map<string, ParticipantRef>();

		for (const tx of currencyTxns) {
			const payerKey = pkey(tx.paidByType, tx.paidById);
			refMap.set(payerKey, {
				participantType: tx.paidByType,
				participantId: tx.paidById,
			});
			paidMap.set(payerKey, (paidMap.get(payerKey) ?? 0) + toNum(tx.amount));

			for (const sp of tx.splitParticipants) {
				const spKey = pkey(sp.participantType, sp.participantId);
				refMap.set(spKey, {
					participantType: sp.participantType,
					participantId: sp.participantId,
				});
				shareMap.set(spKey, (shareMap.get(spKey) ?? 0) + toNum(sp.shareAmount));
			}
		}

		// Subtract FINALIZED settlements between project participants.
		// Settlement from P→Q: P paid Q, so P's net goes up, Q's net goes down.
		const settlementOut = new Map<string, number>(); // paid out by key
		const settlementIn = new Map<string, number>(); // received by key

		for (const s of existingSettlements) {
			if (s.currency !== currency) continue;
			const fromKey = pkey(s.fromParticipantType, s.fromParticipantId);
			const toKey = pkey(s.toParticipantType, s.toParticipantId);
			// Skip if neither party is a transaction participant in this currency
			if (!refMap.has(fromKey) && !refMap.has(toKey)) continue;
			const amt = toNum(s.amount);
			settlementOut.set(fromKey, (settlementOut.get(fromKey) ?? 0) + amt);
			settlementIn.set(toKey, (settlementIn.get(toKey) ?? 0) + amt);
		}

		// Compute net balance for each participant
		const allKeys = new Set([...paidMap.keys(), ...shareMap.keys()]);
		for (const k of allKeys) allParticipantKeys.add(k);

		const netMap = new Map<string, number>();
		const balances: ParticipantBalance[] = [];

		for (const key of allKeys) {
			const paid = paidMap.get(key) ?? 0;
			const share = shareMap.get(key) ?? 0;
			const out = settlementOut.get(key) ?? 0;
			const inn = settlementIn.get(key) ?? 0;
			const net = paid - share + out - inn;
			netMap.set(key, net);
			balances.push({
				participant: refMap.get(key)!,
				totalPaid: Math.round(paid * 100) / 100,
				fairShare: Math.round(share * 100) / 100,
				netBalance: Math.round(net * 100) / 100,
			});
		}

		// Sanity check: balances should sum to ~0
		const balanceSum = [...netMap.values()].reduce((a, b) => a + b, 0);
		if (Math.abs(balanceSum) > 0.01) {
			console.warn(
				`[group-settlement] Balances for ${currency} sum to ${balanceSum.toFixed(6)}, expected ~0`,
			);
		}

		// Step 3: greedy settlement
		const creditors = [...netMap.entries()]
			.filter(([, bal]) => bal > ZERO_TOLERANCE)
			.map(([key, balance]) => ({ key, balance }))
			.sort((a, b) => b.balance - a.balance);

		const debtors = [...netMap.entries()]
			.filter(([, bal]) => bal < -ZERO_TOLERANCE)
			.map(([key, balance]) => ({ key, balance }))
			.sort((a, b) => a.balance - b.balance); // most negative first

		const plan: SettlementStep[] = [];

		while (creditors.length > 0 && debtors.length > 0) {
			const creditor = creditors[0]!;
			const debtor = debtors[0]!;

			const payment = Math.min(creditor.balance, -debtor.balance);
			const roundedPayment = Math.round(payment * 100) / 100;

			if (roundedPayment > 0) {
				plan.push({
					from: refMap.get(debtor.key)!,
					to: refMap.get(creditor.key)!,
					amount: roundedPayment,
					currency,
				});
			}

			// Reduce balances using exact (unrounded) payment to avoid drift
			creditor.balance -= payment;
			debtor.balance += payment;

			if (Math.abs(creditor.balance) < ZERO_TOLERANCE) creditors.shift();
			if (Math.abs(debtor.balance) < ZERO_TOLERANCE) debtors.shift();
		}

		byCurrency[currency] = { plan, balances };
	}

	return { byCurrency, participantCount: allParticipantKeys.size };
}

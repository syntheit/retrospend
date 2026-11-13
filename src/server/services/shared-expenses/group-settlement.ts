import { currencyDecimals, fromMinorUnits } from "@retrospend/domain/money";
import type { ParticipantType } from "~prisma";
import {
	Accounts,
	type Amount,
	ledgerOrder,
	post,
	refKey,
} from "./ledger-posting";

// ── input types ───────────────────────────────────────────────────────────────

/** Minimal transaction shape needed for settlement plan computation. */
export interface TxForSettlement {
	currency: string;
	/** Full amount paid by the payer. */
	amount: Amount;
	paidByType: ParticipantType;
	paidById: string;
	splitParticipants: Array<{
		participantType: ParticipantType;
		participantId: string;
		/** This participant's share of the transaction. */
		shareAmount: Amount;
	}>;
}

/** Minimal settlement row. Only pass settlements in BALANCE_SETTLEMENT_STATUSES. */
export interface SettlementForPlan {
	fromParticipantType: ParticipantType;
	fromParticipantId: string;
	toParticipantType: ParticipantType;
	toParticipantId: string;
	/** Settlement amount. */
	amount: Amount;
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

/**
 * Balances below half of the currency's smallest unit (in absolute value) are
 * treated as zero: 0.005 USD, 0.5 JPY, 0.000000005 BTC.
 */
function zeroTolerance(currency: string): number {
	return 0.5 * 10 ** -currencyDecimals(currency);
}

// ── algorithm ─────────────────────────────────────────────────────────────────

/**
 * The greedy matcher behind computeSettlementPlan, for one currency: the
 * largest creditor is paid by the largest debtor until every balance is
 * within `tolerance` of zero. Exported so the project summary can run it on
 * integer minor units (tolerance 0.5, no rounding), where it is exact.
 *
 * `balances` are signed: positive = is owed, negative = owes. Ties keep the
 * input order (Array.prototype.sort is stable).
 */
export function planGreedyTransfers<Ref>(
	balances: ReadonlyArray<{ ref: Ref; balance: number }>,
	tolerance: number,
	round: (amount: number) => number,
): Array<{ from: Ref; to: Ref; amount: number }> {
	const creditors = balances
		.filter((b) => b.balance > tolerance)
		.map((b) => ({ ...b }))
		.sort((a, b) => b.balance - a.balance);
	const debtors = balances
		.filter((b) => b.balance < -tolerance)
		.map((b) => ({ ...b }))
		.sort((a, b) => a.balance - b.balance); // most negative first

	const plan: Array<{ from: Ref; to: Ref; amount: number }> = [];
	while (creditors.length > 0 && debtors.length > 0) {
		const creditor = creditors[0]!;
		const debtor = debtors[0]!;
		const payment = Math.min(creditor.balance, -debtor.balance);
		const rounded = round(payment);
		if (rounded > 0) {
			plan.push({ from: debtor.ref, to: creditor.ref, amount: rounded });
		}
		// Reduce balances using the exact (unrounded) payment to avoid drift.
		creditor.balance -= payment;
		debtor.balance += payment;
		if (Math.abs(creditor.balance) < tolerance) creditors.shift();
		if (Math.abs(debtor.balance) < tolerance) debtors.shift();
	}
	return plan;
}

/**
 * Compute an optimal greedy settlement plan for a set of shared transactions.
 *
 * Step 1: Group transactions and payments by currency. Each currency is
 *   processed independently.
 *
 * Step 2: For each currency, post the ledger into integer minor units with
 *   the posting the project summary uses (ledger-posting.ts): each expense
 *   amount, share and payment is rounded once, half to even, and
 *   net = paid - share - received + sent. Any part of an expense that no
 *   share covers (someone used "Remove me") counts as the payer's own share,
 *   and so does a rounding excess, so the nets add up to zero unless the
 *   shares exceed their expense exactly (a data fault, shown as the
 *   summary's `imbalance`). Positive net = creditor (is
 *   owed money). Negative net = debtor (owes money).
 *
 * Step 3: Greedy settlement on those integer minor-unit balances (the matcher
 *   the project summary runs), so every payment is exact and the plan settles
 *   the balances it lists: repeatedly match the largest creditor with the
 *   largest debtor until every balance is within half a unit of zero.
 *
 * @param transactions  Transactions with their split participants. Must be
 *                      pre-filtered to the desired project/period scope.
 * @param existingSettlements  Counted settlements (BALANCE_SETTLEMENT_STATUSES) between project participants.
 *                             These reduce the remaining balances before computing
 *                             the plan.
 */
export function computeSettlementPlan(
	transactions: TxForSettlement[],
	existingSettlements: SettlementForPlan[],
): SettlementPlanResult {
	// Currencies come from the expenses and from the payments: a payment in a
	// currency with no expense is money that has to go back, as in the summary.
	const currencies = new Set([
		...transactions.map((tx) => tx.currency),
		...existingSettlements.map((s) => s.currency),
	]);
	const people = new Set<string>();
	for (const tx of transactions) {
		people.add(
			refKey({ participantType: tx.paidByType, participantId: tx.paidById }),
		);
		for (const sp of tx.splitParticipants) people.add(refKey(sp));
	}

	const byCurrency: Record<string, CurrencyBreakdown> = {};
	for (const currency of currencies) {
		const ledger = {
			transactions: transactions.filter((tx) => tx.currency === currency),
			settlements: existingSettlements.filter((s) => s.currency === currency),
		};
		const accounts = new Accounts();
		post(ledger, accounts);

		const balances: ParticipantBalance[] = [];
		const signed: Array<{ ref: ParticipantRef; balance: number }> = [];
		for (const key of ledgerOrder(ledger, currency)) {
			const line = accounts.lines.get(key)?.get(currency);
			const participant = accounts.refs.get(key);
			if (!line || !participant) continue;
			signed.push({ ref: participant, balance: line.balance });
			balances.push({
				participant,
				totalPaid: fromMinorUnits(line.paid, currency),
				fairShare: fromMinorUnits(line.share, currency),
				netBalance: fromMinorUnits(line.balance, currency),
			});
		}

		// Integer balances: half a unit separates zero from one.
		const plan: SettlementStep[] = planGreedyTransfers(
			signed,
			0.5,
			(amount) => amount,
		).map((step) => ({
			...step,
			amount: fromMinorUnits(step.amount, currency),
			currency,
		}));
		byCurrency[currency] = { plan, balances };
	}

	return { byCurrency, participantCount: people.size };
}

/** Returns true when there are no outstanding payments in any currency. */
export function isFullySettled(plan: SettlementPlanResult): boolean {
	return Object.values(plan.byCurrency).every((c) => c.plan.length === 0);
}

// ── billing-period settle check ───────────────────────────────────────────────

export interface PeriodOutstanding {
	participant: ParticipantRef;
	currency: string;
	/**
	 * What is still open for this participant from the period (and earlier):
	 * positive = still owed to them, negative = they still owe.
	 */
	amount: number;
}

/**
 * Decide what is still outstanding for a billing period when settlements are
 * not tied to a period (Settlement.billingPeriodId is never set: settle-ups
 * happen on the project-wide balance).
 *
 * Settlements are applied oldest debt first. A participant's net payments
 * first cover what they owed through the end of this period; anything beyond
 * that belongs to later periods. So the period is settled when:
 * - everyone who owed through this period has paid at least that much (net),
 * - everyone who was owed through this period has received at least that much.
 * Participants who were even through this period are ignored: their payments
 * relate to later periods.
 *
 * @param throughPeriodTxs  Expenses of this period AND every earlier period
 *                          (plus project expenses without a period).
 * @param settlements       All counted settlements (BALANCE_SETTLEMENT_STATUSES) of the project.
 * @returns The participants that are still open, largest first. Empty = settled.
 */
export function computePeriodOutstanding(
	throughPeriodTxs: TxForSettlement[],
	settlements: SettlementForPlan[],
): PeriodOutstanding[] {
	const before = computeSettlementPlan(throughPeriodTxs, []);
	const after = computeSettlementPlan(throughPeriodTxs, settlements);

	const outstanding: PeriodOutstanding[] = [];
	for (const [currency, breakdown] of Object.entries(before.byCurrency)) {
		const ZERO_TOLERANCE = zeroTolerance(currency);
		const afterNet = new Map<string, number>();
		for (const b of after.byCurrency[currency]?.balances ?? []) {
			afterNet.set(refKey(b.participant), b.netBalance);
		}

		for (const b of breakdown.balances) {
			const owedBefore = b.netBalance;
			const net = afterNet.get(refKey(b.participant)) ?? owedBefore;
			const stillOwes = owedBefore < -ZERO_TOLERANCE && net < -ZERO_TOLERANCE;
			const stillOwed = owedBefore > ZERO_TOLERANCE && net > ZERO_TOLERANCE;
			if (stillOwes || stillOwed) {
				outstanding.push({ participant: b.participant, currency, amount: net });
			}
		}
	}

	return outstanding.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/**
 * What is open in currencies that have payments but no expense anywhere in
 * the project: nothing in any period explains them, so no period is settled
 * while they stand. `allTxs` is every expense of the project.
 */
export function computePaymentOnlyOutstanding(
	allTxs: TxForSettlement[],
	settlements: SettlementForPlan[],
): PeriodOutstanding[] {
	const withExpenses = new Set(allTxs.map((tx) => tx.currency));
	const plan = computeSettlementPlan(allTxs, settlements);
	return Object.entries(plan.byCurrency).flatMap(([currency, breakdown]) =>
		withExpenses.has(currency)
			? []
			: breakdown.balances
					.filter((b) => Math.abs(b.netBalance) > zeroTolerance(currency))
					.map((b) => ({
						participant: b.participant,
						currency,
						amount: b.netBalance,
					})),
	);
}

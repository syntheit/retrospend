/**
 * The project summary's numbers (MONEY-MOVES §1.10), as a pure function of
 * the project ledger. Per member and per currency, in integer minor units:
 *
 *   Paid      expenses they paid
 *   Share     their shares of expenses
 *   Received  payments to them
 *   Sent      payments from them
 *   Balance   Paid − Share − Received + Sent   (positive: the group owes them)
 *
 * Balances add up to zero over the members in each currency (I9) whenever
 * each expense's shares add up to its total; `imbalance` lists any currency
 * where they do not, so a page never claims "adds up to zero" when it does
 * not. Currencies are never converted or netted against each other.
 *
 * "Who pays whom" is the fewest transfers that settle each currency, from
 * the same greedy matcher as the settlement plan, run on minor units so
 * every amount is exact.
 */
import type { Money } from "~/server/figures/registry";
import { toMinor } from "~/server/services/envelope/units";
import { planGreedyTransfers } from "~/server/services/shared-expenses/group-settlement";
import type { ParticipantType } from "~prisma";

export interface SummaryRef {
	participantType: ParticipantType;
	participantId: string;
}

/** A person's id in figures and DTOs: `<participantType>:<participantId>`. */
export const refKey = (r: SummaryRef) =>
	`${r.participantType}:${r.participantId}`;

type Amount = number | { toString(): string };

export interface SummaryLedger {
	transactions: ReadonlyArray<{
		currency: string;
		amount: Amount;
		paidByType: ParticipantType;
		paidById: string;
		splitParticipants: ReadonlyArray<{
			participantType: ParticipantType;
			participantId: string;
			shareAmount: Amount;
		}>;
	}>;
	settlements: ReadonlyArray<{
		fromParticipantType: ParticipantType;
		fromParticipantId: string;
		toParticipantType: ParticipantType;
		toParticipantId: string;
		amount: Amount;
		currency: string;
	}>;
}

export interface MemberLine {
	currency: string;
	paid: number;
	share: number;
	received: number;
	sent: number;
	balance: number;
}

export interface MemberNumbers {
	ref: SummaryRef;
	key: string;
	/** One line per currency the member appears in, sorted by currency. */
	lines: MemberLine[];
}

export interface Transfer {
	from: SummaryRef;
	to: SummaryRef;
	amount: Money;
}

export interface ProjectNumbers {
	/** Every expense in the project, per currency. */
	total: Money[];
	members: MemberNumbers[];
	transfers: Transfer[];
	/** Currencies whose balances do not add up to zero, with the sum. Empty when I9 holds. */
	imbalance: Money[];
}

const minor = (value: Amount, currency: string) =>
	toMinor(value.toString(), currency);

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Field = Exclude<keyof MemberLine, "currency" | "balance">;

class Accounts {
	readonly refs = new Map<string, SummaryRef>();
	readonly lines = new Map<string, Map<string, MemberLine>>();

	add(ref: SummaryRef, currency: string, field: Field, amount: number) {
		const key = refKey(ref);
		if (!this.refs.has(key)) {
			// A copy: split rows passed in as refs carry their share too.
			this.refs.set(key, {
				participantType: ref.participantType,
				participantId: ref.participantId,
			});
		}
		const byCurrency = this.lines.get(key) ?? new Map<string, MemberLine>();
		this.lines.set(key, byCurrency);
		const line = byCurrency.get(currency) ?? {
			currency,
			paid: 0,
			share: 0,
			received: 0,
			sent: 0,
			balance: 0,
		};
		line[field] += amount;
		line.balance = line.paid - line.share - line.received + line.sent;
		byCurrency.set(currency, line);
	}
}

function post(ledger: SummaryLedger, accounts: Accounts) {
	const total = new Map<string, number>();
	for (const tx of ledger.transactions) {
		const amount = minor(tx.amount, tx.currency);
		total.set(tx.currency, (total.get(tx.currency) ?? 0) + amount);
		const payer = {
			participantType: tx.paidByType,
			participantId: tx.paidById,
		};
		accounts.add(payer, tx.currency, "paid", amount);
		for (const sp of tx.splitParticipants) {
			accounts.add(
				sp,
				tx.currency,
				"share",
				minor(sp.shareAmount, tx.currency),
			);
		}
	}
	for (const s of ledger.settlements) {
		const amount = minor(s.amount, s.currency);
		const from = {
			participantType: s.fromParticipantType,
			participantId: s.fromParticipantId,
		};
		const to = {
			participantType: s.toParticipantType,
			participantId: s.toParticipantId,
		};
		accounts.add(from, s.currency, "sent", amount);
		accounts.add(to, s.currency, "received", amount);
	}
	return total;
}

/**
 * The order the settlement plan meets people in one currency: payers in
 * ledger order, then everyone with a share, then anyone only in a payment.
 * The matcher breaks ties by this order, so the summary and the settlement
 * plan list equal debts the same way.
 */
function ledgerOrder(ledger: SummaryLedger, currency: string): string[] {
	const txs = ledger.transactions.filter((t) => t.currency === currency);
	const keys = new Set<string>();
	for (const t of txs) {
		keys.add(
			refKey({ participantType: t.paidByType, participantId: t.paidById }),
		);
	}
	for (const t of txs)
		for (const sp of t.splitParticipants) keys.add(refKey(sp));
	for (const s of ledger.settlements.filter((x) => x.currency === currency)) {
		keys.add(
			refKey({
				participantType: s.fromParticipantType,
				participantId: s.fromParticipantId,
			}),
		);
		keys.add(
			refKey({
				participantType: s.toParticipantType,
				participantId: s.toParticipantId,
			}),
		);
	}
	return [...keys];
}

/**
 * @param members The project's members, listed first in this order even with
 *   nothing on their lines; anyone else on the ledger (a former member)
 *   follows, sorted by key.
 */
export function summarizeLedger(
	ledger: SummaryLedger,
	members: readonly SummaryRef[] = [],
): ProjectNumbers {
	const accounts = new Accounts();
	const total = post(ledger, accounts);

	const listed = new Set(members.map(refKey));
	const others = [...accounts.refs.keys()]
		.filter((k) => !listed.has(k))
		.sort(byCode);
	const ordered: MemberNumbers[] = [
		...members.map((ref) => ({ ref, key: refKey(ref) })),
		...others.map((key) => ({
			ref: accounts.refs.get(key) as SummaryRef,
			key,
		})),
	].map(({ ref, key }) => ({
		ref,
		key,
		lines: [...(accounts.lines.get(key)?.values() ?? [])].sort((a, b) =>
			byCode(a.currency, b.currency),
		),
	}));

	const currencies = [
		...new Set(ordered.flatMap((m) => m.lines.map((l) => l.currency))),
	].sort(byCode);
	const transfers: Transfer[] = [];
	const imbalance: Money[] = [];
	for (const currency of currencies) {
		const byKey = new Map(ordered.map((m) => [m.key, m]));
		const balances = ledgerOrder(ledger, currency).flatMap((key) => {
			const m = byKey.get(key);
			const line = m?.lines.find((l) => l.currency === currency);
			return m && line ? [{ ref: m.ref, balance: line.balance }] : [];
		});
		const sum = balances.reduce((t, b) => t + b.balance, 0);
		if (sum !== 0) imbalance.push({ minor: sum, currency });
		// Integer balances: half a minor unit separates zero from one unit.
		for (const step of planGreedyTransfers(balances, 0.5, (x) => x)) {
			transfers.push({
				from: step.from,
				to: step.to,
				amount: { minor: step.amount, currency },
			});
		}
	}

	return {
		total: [...total.entries()]
			.map(([currency, m]) => ({ minor: m, currency }))
			.sort((a, b) => byCode(a.currency, b.currency)),
		members: ordered,
		transfers,
		imbalance,
	};
}

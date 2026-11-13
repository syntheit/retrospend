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
 * The posting itself (shared-expenses/ledger-posting.ts) is the one the
 * settlement plan reads too. Balances add up to zero over the members in each
 * currency (I9) whenever no expense's shares exceed its total; `imbalance`
 * lists any currency where they do not, so a page never claims "adds up to
 * zero" when it does not. Currencies are never converted or netted against
 * each other.
 *
 * "Who pays whom" is the fewest transfers that settle each currency, from
 * the same greedy matcher as the settlement plan, run on minor units so
 * every amount is exact.
 */
import type { Money } from "~/server/figures/registry";
import { planGreedyTransfers } from "~/server/services/shared-expenses/group-settlement";
import {
	Accounts,
	ledgerOrder,
	type MemberLine,
	type PostingLedger,
	post,
	refKey,
	type SummaryRef,
} from "~/server/services/shared-expenses/ledger-posting";

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

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param members The project's members, listed first in this order even with
 *   nothing on their lines; anyone else on the ledger (a former member)
 *   follows, sorted by key.
 */
export function summarizeLedger(
	ledger: PostingLedger,
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

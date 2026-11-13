/**
 * The one posting of a shared ledger into per-person, per-currency integer
 * minor units (MONEY-MOVES §1.10). The project summary, the settlement plan,
 * the project list badge and the billing-period settle check all read their
 * balances from here, so one expense is rounded one way everywhere:
 *
 *   Paid      expenses they paid, each amount rounded once (half even)
 *   Share     their shares, each share rounded once
 *   Received  payments to them
 *   Sent      payments from them
 *   Balance   Paid - Share - Received + Sent   (positive: the group owes them)
 *
 * Rounding per row, never per total: it is the figure the Summary tab and the
 * People page show, so a legacy row stored at 8 decimals (three shares of
 * 12.73333333 of 38.20) reads the same on every screen. The part of an
 * expense no share covers is the payer's own share (after "Remove me"), and
 * so is a rounding excess when the exact shares do not exceed the amount; a
 * share total that exceeds the amount exactly is a data fault and stays a
 * non-zero sum.
 */

import { type Decimal, dec } from "@retrospend/domain/precise-decimal";
import { toMinor } from "~/server/services/envelope/units";
import type { ParticipantType } from "~prisma";

export interface SummaryRef {
	participantType: ParticipantType;
	participantId: string;
}

/** A person's id in figures and DTOs: `<participantType>:<participantId>`. */
export const refKey = (r: SummaryRef) =>
	`${r.participantType}:${r.participantId}`;

/** A stored amount: decimal text or an exact Decimal, never a float. */
export type Amount = string | Decimal;

export interface PostingLedger {
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

const minor = (value: Amount, currency: string) =>
	toMinor(value.toString(), currency);

type Field = Exclude<keyof MemberLine, "currency" | "balance">;

export class Accounts {
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

/** Posts every expense and payment of `ledger` into `accounts`; returns each currency's expense total. */
export function post(ledger: PostingLedger, accounts: Accounts) {
	const total = new Map<string, number>();
	for (const tx of ledger.transactions) {
		const amount = minor(tx.amount, tx.currency);
		total.set(tx.currency, (total.get(tx.currency) ?? 0) + amount);
		const payer = {
			participantType: tx.paidByType,
			participantId: tx.paidById,
		};
		accounts.add(payer, tx.currency, "paid", amount);
		let covered = 0;
		let exactShares = dec(0);
		for (const sp of tx.splitParticipants) {
			const share = minor(sp.shareAmount, tx.currency);
			covered += share;
			exactShares = exactShares.plus(dec(sp.shareAmount));
			accounts.add(sp, tx.currency, "share", share);
		}
		// The payer absorbs what no share covers ("Remove me" leaves a gap
		// nobody owes back) and, the other way, what rounding each share on its
		// own row adds past the amount (5.015 twice of 10.03 rounds to 5.02
		// twice, 10.04): the payer's own share is that much smaller, as the
		// People page has it. Only shares that exceed the amount exactly are a
		// data fault, and they stay visible as an imbalance.
		const exactOver = exactShares.gt(dec(tx.amount));
		if (amount > covered || (covered > amount && !exactOver)) {
			accounts.add(payer, tx.currency, "share", amount - covered);
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
export function ledgerOrder(ledger: PostingLedger, currency: string): string[] {
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

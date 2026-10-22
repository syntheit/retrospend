/**
 * What the settle sheet renders from an allocation (R9: the server computes,
 * the client formats): every amount a Money DTO in minor units, rates as
 * decimal strings, scopes as project ids or null for Outside projects.
 */
import type { Money } from "~/server/figures/registry";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Allocation } from "./allocate";
import type { Quote, Scope } from "./types";

export interface RateView {
	readonly rateType: string;
	/** Payment-currency units per 1 unit of the row's currency. */
	readonly perUnit: string;
}

export interface AllocationView {
	readonly amount: Money;
	/** "Everything" in the payment currency. */
	readonly full: Money;
	readonly everything: boolean;
	readonly rows: readonly {
		scope: Scope;
		pays: Money;
		paid: Money;
		rate: RateView | null;
		excess: boolean;
	}[];
	readonly offsets: readonly {
		scope: Scope;
		cancels: Money;
		owedBy: "payer" | "payee";
		value: Money;
	}[];
	readonly remainder: readonly { scope: Scope; owed: Money }[];
	/** More than everything owed; recorded only with allowOverpay. */
	readonly overpay: Money | null;
	/** Currencies left untouched for want of a rate. */
	readonly unpriced: readonly string[];
}

const money = (minor: number, currency: string): Money => ({ minor, currency });

const rateOf = (q: Quote | null): RateView | null =>
	q ? { rateType: q.rateType, perUnit: q.perUnit.toString() } : null;

export function viewAllocation(a: Allocation): AllocationView {
	const P = a.currency;
	return {
		amount: money(a.amount, P),
		full: money(a.full, P),
		everything: a.everything,
		rows: a.rows.map((r) => ({
			scope: r.scope,
			pays: money(r.amount, r.currency),
			paid: money(r.paid, P),
			rate: rateOf(r.quote),
			excess: r.excess,
		})),
		offsets: a.offsets.map((o) => ({
			scope: o.scope,
			cancels: money(o.amount, o.currency),
			owedBy: o.from,
			value: money(o.value, P),
		})),
		remainder: a.remainder.map((r) => ({
			scope: r.scope,
			owed: money(r.amount, r.currency),
		})),
		overpay: a.overpay > 0 ? money(a.overpay, P) : null,
		unpriced: a.unpriced,
	};
}

/** The figures' personId narrowing for a participant: "type:id". */
export const personKey = (ref: ParticipantRef) =>
	`${ref.participantType}:${ref.participantId}`;

/** The inverse of personKey; null when the key is not one. */
export function parsePersonKey(key: string): ParticipantRef | null {
	const [type, ...rest] = key.split(":");
	const id = rest.join(":");
	if ((type === "user" || type === "guest" || type === "shadow") && id) {
		return { participantType: type, participantId: id };
	}
	return null;
}

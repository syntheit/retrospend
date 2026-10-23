/**
 * "Same payment?" (MONEY-MOVES §1.5): when the receiver records money that
 * looks like a claim the payer already made, the two are one payment.
 * A claim matches when it is from the same payer to the same receiver,
 * still pending, in the same currency (or within 2% after converting it at
 * the payment's quote), within 2% of the amount and within 7 days.
 */
import { TRPCError } from "@trpc/server";
import { currencyDecimals } from "~/lib/money";
import { fromMinor } from "~/server/services/envelope/units";
import type { IsoDate, Minor } from "./types";

export interface Claim {
	readonly paymentId: string;
	readonly amount: Minor;
	readonly currency: string;
	readonly paidOn: IsoDate;
	readonly paymentMethod: string | null;
}

export interface ClaimMatch {
	readonly claim: Claim;
	/** The claim, in the new payment's currency. */
	readonly amountInPaymentCurrency: Minor;
	/** Equal amounts: confirming changes nothing but method and date. */
	readonly sameAmount: boolean;
}

export const MATCH_DAYS = 7;
/** 2% as basis points. */
const MATCH_TOLERANCE_BP = 200;

const DAY_MS = 86_400_000;

function daysBetween(a: IsoDate, b: IsoDate): number {
	return (
		Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
		DAY_MS
	);
}

/** |a - b| <= 2% of b, in integers. */
function within(a: Minor, b: Minor): boolean {
	return Math.abs(a - b) * 10_000 <= MATCH_TOLERANCE_BP * Math.abs(b);
}

/**
 * The best open claim for a payment the receiver is recording, or null.
 * `convert` turns a claim amount into the payment currency (null when no
 * quote). Closest amount wins, then closest date.
 */
export function findClaimMatch(
	claims: readonly Claim[],
	payment: { amount: Minor; currency: string; paidOn: IsoDate },
	convert: (amount: Minor, currency: string) => Minor | null,
): ClaimMatch | null {
	let best: (ClaimMatch & { gap: number; days: number }) | null = null;
	for (const claim of claims) {
		const days = daysBetween(claim.paidOn, payment.paidOn);
		if (days > MATCH_DAYS) continue;
		const converted =
			claim.currency === payment.currency
				? claim.amount
				: convert(claim.amount, claim.currency);
		if (converted === null || !within(converted, payment.amount)) continue;
		const gap = Math.abs(converted - payment.amount);
		if (best && (gap > best.gap || (gap === best.gap && days >= best.days))) {
			continue;
		}
		best = {
			claim,
			amountInPaymentCurrency: converted,
			sameAmount: claim.currency === payment.currency && gap === 0,
			gap,
			days,
		};
	}
	if (!best) return null;
	const { gap: _gap, days: _days, ...match } = best;
	return match;
}

/**
 * The refusal when money received matches a pending claim and the caller did
 * not choose: the claim is the same money, so it is confirmed, not recorded
 * again. `name` is the payer's display name.
 */
export function claimMatchError(match: ClaimMatch, name: string): TRPCError {
	const { amount, currency, paidOn } = match.claim;
	const shown = fromMinor(amount, currency).toFixed(currencyDecimals(currency));
	return new TRPCError({
		code: "CONFLICT",
		message: `${name} says they already paid you ${currency} ${shown} on ${paidOn}. Confirm that payment, or record this as a different payment.`,
	});
}

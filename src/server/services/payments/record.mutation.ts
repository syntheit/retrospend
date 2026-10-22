/**
 * payment.record (MONEY-MOVES §1): one payment between the current user and
 * one person, allocated by allocatePayment and written as a Payment header
 * plus its rows. The settle sheet's preview runs this same mutation and
 * rolls it back (R30), so "This pays" is exactly what Record writes.
 *
 * It does not throw for an overpayment or for nothing owed: it writes
 * nothing and says why, so the preview can show the confirm ("That is ARS
 * 1,000 more than Valentina owes"). The transport turns that into an error
 * on record.
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { toMinor } from "~/server/services/envelope/units";
import type { MoneyMutation } from "~/server/services/preview/types";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import {
	type ParticipantRef,
	sameParticipant,
} from "~/server/services/shared-expenses/types";
import {
	assertProjectInvolvement,
	assertRelationship,
	lockPair,
} from "./access";
import { allocatePayment, toPaymentCurrency } from "./allocate";
import { type ClaimMatch, findClaimMatch } from "./claim-match";
import { confirmClaim } from "./confirm.mutation";
import { confirmationFor } from "./confirmation";
import { ledgerLines, payerLines } from "./ledger";
import { loadQuotes } from "./quotes";
import type { ApplyTo, Quote } from "./types";
import { type AllocationView, personKey, viewAllocation } from "./view";
import { writePayment } from "./write";

export const PAYMENT_FIGURES = [
	"balance.person",
	"owed.owedToYou",
	"owed.youOwe",
];

export interface RecordPaymentInput {
	/** The other person. */
	readonly person: ParticipantRef;
	/** "outgoing": I paid them. "incoming": they paid me (final at once). */
	readonly direction: "outgoing" | "incoming";
	readonly currency: string;
	/** Decimal string in `currency`; null pays everything. */
	readonly amount: string | null;
	/** Rate type for parts that convert; null = the reference type. */
	readonly rateType?: string | null;
	/** A typed rate: `rate` units of `currency` per 1 unit of `rateCurrency`. */
	readonly customRate?: {
		readonly rate: string;
		readonly currency: string;
	} | null;
	readonly paymentMethod?: string | null;
	/** YYYY-MM-DD the money moved; today when omitted. */
	readonly paidOn?: string | null;
	readonly note?: string | null;
	/** "Apply to": scopes (null = Outside projects) and optionally a currency in each. */
	readonly applyTo?: readonly ApplyTo[];
	/** The user confirmed paying more than everything owed (owner Q2). */
	readonly allowOverpay?: boolean;
	/** "Same payment": confirm this pending claim with these details instead (§1.5). */
	readonly matchClaimId?: string | null;
	/** The receiver said this is not the payment the payer already claims (§1.5). */
	readonly differentPayment?: boolean;
	/** Extra audit context of a legacy entry point. */
	readonly auditTags?: Readonly<Record<string, true>>;
}

export type RecordPaymentValue =
	| {
			readonly recorded: true;
			readonly paymentId: string;
			readonly status: "PROPOSED" | "FINALIZED";
			/** Null when it confirmed a claim as it was ("Same payment"). */
			readonly allocation: AllocationView | null;
			readonly match: ClaimMatch | null;
	  }
	| {
			readonly recorded: false;
			/**
			 * matches_claim: money received that looks like a pending claim of the
			 * payer; recording it as well would count it twice. Confirm the claim
			 * (matchClaimId) or say it is a different payment.
			 */
			readonly reason: "overpay" | "nothing_owed" | "matches_claim";
			readonly allocation: AllocationView;
			readonly match: ClaimMatch | null;
	  };

const userRef = (userId: string): ParticipantRef => ({
	participantType: "user",
	participantId: userId,
});

/** The calendar day a payment is dated, as a UTC midnight. */
export function paidOnDate(paidOn: string | null | undefined, now: Date): Date {
	const day = paidOn ?? now.toISOString().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a valid date" });
	}
	return new Date(`${day}T00:00:00.000Z`);
}

async function checkAccess(
	tx: Parameters<typeof assertRelationship>[0],
	me: ParticipantRef,
	input: RecordPaymentInput,
) {
	if (sameParticipant(me, input.person)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Cannot create a settlement with yourself",
		});
	}
	await assertRelationship(tx, me, input.person);
	for (const scope of new Set(input.applyTo?.map((a) => a.scope))) {
		if (typeof scope === "string")
			await assertProjectInvolvement(tx, me, scope);
	}
}

/** The receiver's open claims from this person, matched against the new payment (§1.5). */
async function claimMatch(
	tx: Parameters<typeof assertRelationship>[0],
	me: ParticipantRef,
	person: ParticipantRef,
	payment: { amount: number; currency: string; paidOn: Date },
	quotes: ReadonlyMap<string, Quote>,
): Promise<ClaimMatch | null> {
	const claims = await tx.payment.findMany({
		where: {
			status: "PROPOSED",
			payerType: person.participantType,
			payerId: person.participantId,
			payeeType: me.participantType,
			payeeId: me.participantId,
		},
	});
	return findClaimMatch(
		claims.map((c) => ({
			paymentId: c.id,
			amount: toMinor(c.amount.toString(), c.currency),
			currency: c.currency,
			paidOn: c.paidOn.toISOString().slice(0, 10),
			paymentMethod: c.paymentMethod,
		})),
		{ ...payment, paidOn: payment.paidOn.toISOString().slice(0, 10) },
		(minor, currency) => {
			const quote = quotes.get(currency);
			return quote
				? toPaymentCurrency(minor, currency, payment.currency, quote)
				: null;
		},
	);
}

export const recordPayment: MoneyMutation<
	RecordPaymentInput,
	RecordPaymentValue
> = {
	id: "payment.record",
	touches: PAYMENT_FIGURES,
	scope: (input) => ({ personId: personKey(input.person) }),
	run: async (tx, input, actor) => {
		const me = userRef(actor.userId);
		await checkAccess(tx, me, input);
		await lockPair(tx, me, input.person);
		if (input.matchClaimId) {
			const confirmed = await confirmClaim(tx, me, {
				paymentId: input.matchClaimId,
				paymentMethod: input.paymentMethod,
				paidOn: input.paidOn,
				amount: input.amount,
			});
			return {
				value: {
					recorded: true,
					paymentId: confirmed.paymentId,
					status: "FINALIZED",
					allocation:
						confirmed.allocation && viewAllocation(confirmed.allocation),
					match: null,
				},
				undo: confirmed.undo,
			};
		}

		const now = new Date();
		const paidOn = paidOnDate(input.paidOn, now);
		const outgoing = input.direction === "outgoing";
		const events = await computePairLedger(tx, me, input.person, {
			viewer: me,
		});
		const lines = payerLines(ledgerLines(events), outgoing);
		const quotes = await loadQuotes(tx, {
			into: input.currency,
			currencies: lines.map((l) => l.currency),
			date: paidOn,
			rateType: input.rateType,
			custom: input.customRate,
		});
		const allocation = allocatePayment({
			lines,
			currency: input.currency,
			amount:
				input.amount === null ? null : toMinor(input.amount, input.currency),
			quotes,
			applyTo: input.applyTo,
			allowOverpay: input.allowOverpay,
		});
		const view = viewAllocation(allocation);
		const match = outgoing
			? null
			: await claimMatch(
					tx,
					me,
					input.person,
					{ ...allocation, paidOn },
					quotes,
				);
		const id = randomUUID();
		const undo = {
			kind: "revert" as const,
			mutation: "payment.record",
			rows: [{ table: "payment", id }],
		};

		if (match && input.differentPayment !== true) {
			return {
				value: {
					recorded: false,
					reason: "matches_claim",
					allocation: view,
					match,
				},
				undo,
			};
		}
		const owesNothing =
			allocation.gross === 0 && allocation.offsets.length === 0;
		if (allocation.overpay > 0 && input.allowOverpay !== true && !owesNothing) {
			return {
				value: { recorded: false, reason: "overpay", allocation: view, match },
				undo,
			};
		}
		if (
			(owesNothing && input.allowOverpay !== true) ||
			(allocation.rows.length === 0 && allocation.offsets.length === 0)
		) {
			return {
				value: {
					recorded: false,
					reason: "nothing_owed",
					allocation: view,
					match,
				},
				undo,
			};
		}

		const [payer, payee] = outgoing ? [me, input.person] : [input.person, me];
		const confirmation = confirmationFor(!outgoing, payee.participantType);
		await writePayment(tx, {
			id,
			parties: { payer, payee, recorder: me },
			allocation,
			confirmation,
			paidOn,
			now,
			paymentMethod: input.paymentMethod ?? null,
			note: input.note ?? null,
			auditTags: input.auditTags,
		});
		return {
			value: {
				recorded: true,
				paymentId: id,
				status: confirmation.status,
				allocation: view,
				match,
			},
			undo,
		};
	},
};

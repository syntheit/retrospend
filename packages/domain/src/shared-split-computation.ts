/**
 * Pure, isomorphic split-resolution used by BOTH the client preview and the
 * server. It is the single source of truth for how a shared-expense amount is
 * divided across participants, so the amounts a user sees in the form preview
 * are byte-for-byte the amounts the server saves.
 *
 * Amounts are split in the currency's own minor units (cents, satoshis for
 * BTC, fils for KWD, whole yen for JPY; see currencyDecimals in ./money),
 * so 0.003 BTC split three ways is 0.001 each, not 0.
 *
 * The server rounding rule is canonical: any leftover minor unit from an
 * indivisible amount goes to the payer first (when the payer has a split row),
 * otherwise to the last row for PERCENTAGE/SHARES or filled in row order for
 * EQUAL. This file preserves that exact behavior.
 *
 * This module MUST stay free of server-only imports (Prisma, tRPC, env) so it
 * can run in the browser. Validation failures throw {@link SplitComputationError};
 * the server catches it and rethrows as a TRPCError.
 */

import { fromMinorUnits, toMinorUnits } from "./money";

export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface SplitParticipantRef {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
}

export interface SplitParticipantInput extends SplitParticipantRef {
	shareAmount?: number;
	sharePercentage?: number;
	shareUnits?: number;
}

export interface ResolvedSplit extends SplitParticipantRef {
	shareAmount: number;
	sharePercentage?: number;
	shareUnits?: number;
}

/** Thrown on invalid split input (bad sums, missing fields, etc.). */
export class SplitComputationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SplitComputationError";
	}
}

function sameRef(a: SplitParticipantRef, b: SplitParticipantRef): boolean {
	return (
		a.participantType === b.participantType &&
		a.participantId === b.participantId
	);
}

/**
 * Resolve a split into concrete per-participant amounts, accurate to the
 * currency's minor unit. Payer may be outside the split (fronting a cost): they
 * simply get no row. Callers should dedupe participants beforehand.
 */
export function resolveSplits(args: {
	mode: SplitMode;
	amount: number;
	currency: string;
	participants: SplitParticipantInput[];
	paidBy: SplitParticipantRef;
}): ResolvedSplit[] {
	const { mode, amount, currency, participants, paidBy } = args;
	if (mode === "EQUAL")
		return computeEqualSplits(amount, currency, participants, paidBy);
	if (mode === "EXACT") return computeExactSplits(amount, currency, participants);
	if (mode === "PERCENTAGE")
		return computePercentageSplits(amount, currency, participants, paidBy);
	return computeSharesSplits(amount, currency, participants, paidBy);
}

function computeEqualSplits(
	amount: number,
	currency: string,
	splitWith: SplitParticipantInput[],
	paidBy: SplitParticipantRef,
): ResolvedSplit[] {
	const count = splitWith.length;
	// Integer minor units ("cents") avoid floating point issues
	const totalCents = toMinorUnits(amount, currency);
	const baseCents = Math.floor(totalCents / count);
	let remainder = totalCents - baseCents * count;

	const result = splitWith.map((p) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		cents: baseCents,
	}));

	// Assign extra cents: payer first, then others in order
	if (remainder > 0) {
		const payerIdx = result.findIndex((r) => sameRef(r, paidBy));
		if (payerIdx >= 0) {
			result[payerIdx]!.cents += 1;
			remainder -= 1;
		}
		for (let i = 0; i < result.length && remainder > 0; i++) {
			if (i !== payerIdx) {
				result[i]!.cents += 1;
				remainder -= 1;
			}
		}
	}

	return result.map((r) => ({
		participantType: r.participantType,
		participantId: r.participantId,
		shareAmount: fromMinorUnits(r.cents, currency),
	}));
}

function computeExactSplits(
	amount: number,
	currency: string,
	splitWith: SplitParticipantInput[],
): ResolvedSplit[] {
	const totalCents = toMinorUnits(amount, currency);
	const sumCents = splitWith.reduce(
		(sum, p) => sum + toMinorUnits(p.shareAmount ?? 0, currency),
		0,
	);

	if (sumCents !== totalCents) {
		const got = fromMinorUnits(sumCents, currency);
		const difference = fromMinorUnits(
			Math.abs(totalCents - sumCents),
			currency,
		);
		throw new SplitComputationError(
			`Split amounts must sum to the transaction amount. Expected ${amount}, got ${got} (difference: ${difference})`,
		);
	}

	return splitWith.map((p) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		shareAmount: p.shareAmount!,
	}));
}

function computePercentageSplits(
	amount: number,
	currency: string,
	splitWith: SplitParticipantInput[],
	paidBy: SplitParticipantRef,
): ResolvedSplit[] {
	// Validate all participants have sharePercentage
	for (const p of splitWith) {
		if (p.sharePercentage === undefined || p.sharePercentage === null) {
			throw new SplitComputationError(
				`Participant ${p.participantId} is missing sharePercentage for PERCENTAGE split mode`,
			);
		}
	}

	const rawSum = splitWith.reduce((s, p) => s + p.sharePercentage!, 0);
	if (rawSum < 99.99 || rawSum > 100.01) {
		throw new SplitComputationError(
			`Percentages must sum to 100. Got ${rawSum.toFixed(4)}`,
		);
	}

	// Adjust last participant so percentages sum to exactly 100
	const participants = splitWith.map((p) => ({ ...p }));
	const othersSum = participants
		.slice(0, -1)
		.reduce((s, p) => s + p.sharePercentage!, 0);
	participants[participants.length - 1]!.sharePercentage = 100 - othersSum;

	// Compute amounts using integer minor units, floor each
	const totalCents = toMinorUnits(amount, currency);
	const result = participants.map((p) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		sharePercentage: p.sharePercentage!,
		cents: Math.floor((totalCents * p.sharePercentage!) / 100),
	}));

	const sumCents = result.reduce((s, r) => s + r.cents, 0);
	const remainder = totalCents - sumCents;

	if (Math.abs(remainder) > result.length) {
		throw new SplitComputationError(
			"Unexpected large rounding error in percentage split",
		);
	}

	// Assign remainder cents to payer first
	if (remainder !== 0) {
		const payerIdx = result.findIndex((r) => sameRef(r, paidBy));
		const idx = payerIdx >= 0 ? payerIdx : result.length - 1;
		result[idx]!.cents += remainder;
	}

	return result.map((r) => ({
		participantType: r.participantType,
		participantId: r.participantId,
		shareAmount: fromMinorUnits(r.cents, currency),
		sharePercentage: r.sharePercentage,
	}));
}

function computeSharesSplits(
	amount: number,
	currency: string,
	splitWith: SplitParticipantInput[],
	paidBy: SplitParticipantRef,
): ResolvedSplit[] {
	// Validate all participants have positive integer shareUnits
	for (const p of splitWith) {
		if (!p.shareUnits || p.shareUnits < 1) {
			throw new SplitComputationError(
				`Participant ${p.participantId} must have shareUnits >= 1 for SHARES split mode`,
			);
		}
	}

	const totalUnits = splitWith.reduce((s, p) => s + p.shareUnits!, 0);
	const totalCents = toMinorUnits(amount, currency);

	const result = splitWith.map((p) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		shareUnits: p.shareUnits!,
		cents: Math.floor((totalCents * p.shareUnits!) / totalUnits),
	}));

	const sumCents = result.reduce((s, r) => s + r.cents, 0);
	const remainder = totalCents - sumCents;

	if (Math.abs(remainder) > result.length) {
		throw new SplitComputationError(
			"Unexpected large rounding error in shares split",
		);
	}

	// Assign remainder cents to payer first
	if (remainder !== 0) {
		const payerIdx = result.findIndex((r) => sameRef(r, paidBy));
		const idx = payerIdx >= 0 ? payerIdx : result.length - 1;
		result[idx]!.cents += remainder;
	}

	return result.map((r) => ({
		participantType: r.participantType,
		participantId: r.participantId,
		shareAmount: fromMinorUnits(r.cents, currency),
		shareUnits: r.shareUnits,
	}));
}

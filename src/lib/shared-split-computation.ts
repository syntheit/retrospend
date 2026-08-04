/**
 * Pure, isomorphic split-resolution used by BOTH the client preview and the
 * server. It is the single source of truth for how a shared-expense amount is
 * divided across participants, so the amounts a user sees in the form preview
 * are byte-for-byte the amounts the server saves.
 *
 * The server rounding rule is canonical: any leftover cent from an indivisible
 * amount goes to the payer first (when the payer has a split row), otherwise to
 * the last row for PERCENTAGE/SHARES or filled in row order for EQUAL. This
 * file preserves that exact behavior.
 *
 * This module MUST stay free of server-only imports (Prisma, tRPC, env) so it
 * can run in the browser. Validation failures throw {@link SplitComputationError};
 * the server catches it and rethrows as a TRPCError.
 */

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
 * Resolve a split into concrete per-participant amounts (in whole currency
 * units, cent-accurate). Payer may be outside the split (fronting a cost): they
 * simply get no row. Callers should dedupe participants beforehand.
 */
export function resolveSplits(args: {
	mode: SplitMode;
	amount: number;
	participants: SplitParticipantInput[];
	paidBy: SplitParticipantRef;
}): ResolvedSplit[] {
	const { mode, amount, participants, paidBy } = args;
	if (mode === "EQUAL") return computeEqualSplits(amount, participants, paidBy);
	if (mode === "EXACT") return computeExactSplits(amount, participants);
	if (mode === "PERCENTAGE")
		return computePercentageSplits(amount, participants, paidBy);
	return computeSharesSplits(amount, participants, paidBy);
}

function computeEqualSplits(
	amount: number,
	splitWith: SplitParticipantInput[],
	paidBy: SplitParticipantRef,
): ResolvedSplit[] {
	const count = splitWith.length;
	// Use integer cents to avoid floating point issues
	const totalCents = Math.round(amount * 100);
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
		shareAmount: r.cents / 100,
	}));
}

function computeExactSplits(
	amount: number,
	splitWith: SplitParticipantInput[],
): ResolvedSplit[] {
	const totalCents = Math.round(amount * 100);
	const sumCents = splitWith.reduce(
		(sum, p) => sum + Math.round((p.shareAmount ?? 0) * 100),
		0,
	);

	if (sumCents !== totalCents) {
		const difference = Math.abs(amount - sumCents / 100);
		throw new SplitComputationError(
			`Split amounts must sum to the transaction amount. Expected ${amount}, got ${sumCents / 100} (difference: ${difference.toFixed(2)})`,
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

	// Compute amounts using integer cents, floor each
	const totalCents = Math.round(amount * 100);
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
		shareAmount: r.cents / 100,
		sharePercentage: r.sharePercentage,
	}));
}

function computeSharesSplits(
	amount: number,
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
	const totalCents = Math.round(amount * 100);

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
		shareAmount: r.cents / 100,
		shareUnits: r.shareUnits,
	}));
}

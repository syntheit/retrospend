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
 * Leftover units go by a fixed order, not the order rows arrive in (the
 * database returns them in none): the payer first, then the others by
 * participant key. So a create, an edit and an Undo of the same split give the
 * same cents. Results come back in the order the rows were given.
 *
 * A PERCENTAGE split whose rows are all the same share, within a hundredth of
 * a percent of 100 / n, is the even split after rounding (33.33 x 3, 14.29 x 7,
 * what the database kept of 100 / n): it resolves as an EQUAL split, so an
 * amount edit re-splits it exactly instead of from 33.33 each. A share that is
 * exactly 100 / n at 4 decimals (50 x 2, 25 x 4) and any set of unequal shares
 * stay percentages, as typed.
 *
 * All division is BigInt over minor units: a float product like
 * totalMinor * percent / 100 drops a cent above a few hundred dollars
 * (100 - 50.01 is 49.989999..., not 49.99) and passes 2^53 near 1e12 minor
 * units. Only the edges (toMinorUnits, fromMinorUnits) touch floats.
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

/** A fixed order for participants: type, then id. */
export function compareParticipants(
	a: SplitParticipantRef,
	b: SplitParticipantRef,
): number {
	const x = `${a.participantType}:${a.participantId}`;
	const y = `${b.participantType}:${b.participantId}`;
	return x < y ? -1 : x > y ? 1 : 0;
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
	const { participants } = args;
	const order = participants
		.map((_, i) => i)
		.sort(
			(i, j) =>
				compareParticipants(participants[i]!, participants[j]!) || i - j,
		);
	const rows = resolveInOrder({
		...args,
		participants: order.map((i) => participants[i]!),
	});
	const out: ResolvedSplit[] = [];
	order.forEach((i, k) => {
		out[i] = rows[k]!;
	});
	return out;
}

function resolveInOrder(args: {
	mode: SplitMode;
	amount: number;
	currency: string;
	participants: SplitParticipantInput[];
	paidBy: SplitParticipantRef;
}): ResolvedSplit[] {
	const { mode, amount, currency, participants, paidBy } = args;
	if (mode === "EQUAL")
		return computeEqualSplits(amount, currency, participants, paidBy);
	if (mode === "EXACT")
		return computeExactSplits(amount, currency, participants);
	if (mode === "PERCENTAGE")
		return computePercentageSplits(amount, currency, participants, paidBy);
	return computeSharesSplits(amount, currency, participants, paidBy);
}

/** Percentages are read to 8 decimals (the DB keeps 2) as exact integers. */
const PCT_SCALE = 100_000_000;
const PCT_SCALE_BIG = BigInt(PCT_SCALE);
const HUNDRED_PCT = 100n * PCT_SCALE_BIG;
/** The sum tolerance the form has always allowed: 99.99 to 100.01. */
const PCT_TOLERANCE = PCT_SCALE_BIG / 100n;

/** floor(a / b) for b > 0, also for negative a (BigInt `/` truncates). */
function floorDiv(a: bigint, b: bigint): bigint {
	const q = a / b;
	return a % b !== 0n && a < 0n ? q - 1n : q;
}

function safeMinor(totalMinor: number): bigint {
	if (!Number.isSafeInteger(totalMinor)) {
		throw new SplitComputationError("Amount is too large to split exactly");
	}
	return BigInt(totalMinor);
}

function indexOfRef(
	rows: SplitParticipantRef[],
	paidBy: SplitParticipantRef,
): number {
	return rows.findIndex((r) => sameRef(r, paidBy));
}

/** The row that takes leftover units: the payer's when they have one, else the last. */
export function remainderRow(
	rows: SplitParticipantRef[],
	paidBy: SplitParticipantRef,
): number {
	const payerIdx = indexOfRef(rows, paidBy);
	return payerIdx >= 0 ? payerIdx : rows.length - 1;
}

function allocate(
	total: bigint,
	weights: readonly bigint[],
	remainderIdx: number,
): bigint[] {
	const sumWeights = weights.reduce((s, w) => s + w, 0n);
	if (sumWeights <= 0n) {
		throw new SplitComputationError("Split weights must add up to more than 0");
	}
	const out = weights.map((w) => floorDiv(total * w, sumWeights));
	const remainder = total - out.reduce((s, c) => s + c, 0n);
	const limit = BigInt(out.length);
	if (remainder > limit || remainder < -limit) {
		throw new SplitComputationError("Unexpected large rounding error in split");
	}
	out[remainderIdx] = out[remainderIdx]! + remainder;
	return out;
}

/**
 * Splits `totalMinor` (whole minor units) by whole-number weights: each row
 * gets floor(total * weight / sum of weights), then the leftover units go to
 * `remainderIdx` (callers pass the payer's row, else the last row). Exact for
 * any safe-integer total and weights.
 */
export function allocateByWeights(
	totalMinor: number,
	weights: readonly number[],
	remainderIdx: number,
): number[] {
	const big = weights.map((w) => {
		if (!Number.isSafeInteger(w)) {
			throw new SplitComputationError("Split weights must be whole numbers");
		}
		return BigInt(w);
	});
	return allocate(safeMinor(totalMinor), big, remainderIdx).map(Number);
}

function computeEqualSplits(
	amount: number,
	currency: string,
	splitWith: SplitParticipantInput[],
	paidBy: SplitParticipantRef,
): ResolvedSplit[] {
	const count = BigInt(splitWith.length);
	const total = safeMinor(toMinorUnits(amount, currency));
	const base = floorDiv(total, count);
	let remainder = Number(total - base * count);

	const cents = splitWith.map(() => base);

	// Assign extra units: payer first, then others in order
	if (remainder > 0) {
		const payerIdx = indexOfRef(splitWith, paidBy);
		if (payerIdx >= 0) {
			cents[payerIdx] = cents[payerIdx]! + 1n;
			remainder -= 1;
		}
		for (let i = 0; i < cents.length && remainder > 0; i++) {
			if (i !== payerIdx) {
				cents[i] = cents[i]! + 1n;
				remainder -= 1;
			}
		}
	}

	return splitWith.map((p, i) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		shareAmount: fromMinorUnits(Number(cents[i]), currency),
	}));
}

function computeExactSplits(
	amount: number,
	currency: string,
	splitWith: SplitParticipantInput[],
): ResolvedSplit[] {
	const totalCents = safeMinor(toMinorUnits(amount, currency));
	const sumCents = splitWith.reduce(
		(sum, p) => sum + safeMinor(toMinorUnits(p.shareAmount ?? 0, currency)),
		0n,
	);

	if (sumCents !== totalCents) {
		const gap =
			sumCents > totalCents ? sumCents - totalCents : totalCents - sumCents;
		const got = fromMinorUnits(Number(sumCents), currency);
		const difference = fromMinorUnits(Number(gap), currency);
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

/** Percentages are stored to 4 decimals: units of 1e-4 percent in 100%. */
const STORED_UNITS_PER_100 = 1_000_000n;

/**
 * Whether these percentages are the n-way even split after rounding: every row
 * the same share, within a hundredth of a percent of 100 / n, and not exactly
 * 100 / n at a precision the column keeps (50 x 2 and 25 x 4 are typed as is).
 */
function isRoundedEvenSplit(scaled: readonly bigint[]): boolean {
	const n = BigInt(scaled.length);
	const first = scaled[0];
	if (n < 2n || first === undefined || scaled.some((v) => v !== first)) {
		return false;
	}
	const off = first * n - HUNDRED_PCT;
	if ((off < 0n ? -off : off) >= n * PCT_TOLERANCE) return false;
	return off !== 0n || STORED_UNITS_PER_100 % n !== 0n;
}

/** 100 / n in the 4-decimal units the database keeps, rounded to nearest. */
function evenPercentage(n: number): number {
	const count = BigInt(n);
	const units = (STORED_UNITS_PER_100 * 2n + count) / (count * 2n);
	return Number(units) / Number(STORED_UNITS_PER_100 / 100n);
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

	// Percentages as exact integers of 1e-8 percent
	const scaled = splitWith.map((p) =>
		BigInt(Math.round(p.sharePercentage! * PCT_SCALE)),
	);

	// An even split keeps its exact n-way shares, whichever way it was rounded
	// on the way through the database (before its sum is checked: seven 14.29
	// add up to 100.03). Unequal shares are always the typed ones.
	if (isRoundedEvenSplit(scaled)) {
		const even = evenPercentage(splitWith.length);
		return computeEqualSplits(amount, currency, splitWith, paidBy).map(
			(row) => ({ ...row, sharePercentage: even }),
		);
	}

	const rawSum = scaled.reduce((s, v) => s + v, 0n);
	const off =
		rawSum > HUNDRED_PCT ? rawSum - HUNDRED_PCT : HUNDRED_PCT - rawSum;
	if (off > PCT_TOLERANCE) {
		throw new SplitComputationError(
			`Percentages must sum to 100. Got ${(Number(rawSum) / PCT_SCALE).toFixed(4)}`,
		);
	}

	// Adjust last participant so percentages sum to exactly 100
	const othersSum = scaled.slice(0, -1).reduce((s, v) => s + v, 0n);
	scaled[scaled.length - 1] = HUNDRED_PCT - othersSum;

	const cents = allocate(
		safeMinor(toMinorUnits(amount, currency)),
		scaled,
		remainderRow(splitWith, paidBy),
	);

	return splitWith.map((p, i) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		shareAmount: fromMinorUnits(Number(cents[i]), currency),
		sharePercentage: Number(scaled[i]) / PCT_SCALE,
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
		if (
			!p.shareUnits ||
			p.shareUnits < 1 ||
			!Number.isSafeInteger(p.shareUnits)
		) {
			throw new SplitComputationError(
				`Participant ${p.participantId} must have shareUnits >= 1 for SHARES split mode`,
			);
		}
	}

	const cents = allocate(
		safeMinor(toMinorUnits(amount, currency)),
		splitWith.map((p) => BigInt(p.shareUnits!)),
		remainderRow(splitWith, paidBy),
	);

	return splitWith.map((p, i) => ({
		participantType: p.participantType,
		participantId: p.participantId,
		shareAmount: fromMinorUnits(Number(cents[i]), currency),
		shareUnits: p.shareUnits!,
	}));
}

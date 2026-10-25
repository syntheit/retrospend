import { describe, expect, it } from "vitest";
import { fromMinorUnits, toMinorUnits } from "./money";
import {
	allocateByWeights,
	resolveSplits,
	type SplitParticipantInput,
	type SplitParticipantRef,
} from "./shared-split-computation";

/** Small seeded PRNG (mulberry32) so a failure reproduces. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const CURRENCIES = ["USD", "JPY", "KWD", "BTC"];
const ROUNDS = 4000;

function people(n: number): SplitParticipantRef[] {
	return Array.from({ length: n }, (_, i) => ({
		participantType: "user" as const,
		participantId: `p${i}`,
	}));
}

/** The rule: the payer's row takes the leftover, else the last row. */
function leftoverIndex(n: number, payerIdx: number): number {
	return payerIdx >= 0 ? payerIdx : n - 1;
}

/** Reference: exact rational floor in BigInt, leftover to one row. */
function reference(total: bigint, weights: bigint[], leftoverIdx: number) {
	const sum = weights.reduce((s, w) => s + w, 0n);
	const out = weights.map((w) => (total * w) / sum);
	out[leftoverIdx] =
		out[leftoverIdx]! + (total - out.reduce((s, c) => s + c, 0n));
	return out;
}

function randomTotal(next: () => number): bigint {
	// Log-uniform from 1 to 1e13 so small and huge totals both appear.
	const digits = 1 + Math.floor(next() * 13);
	const max = 10 ** digits;
	return BigInt(1 + Math.floor(next() * max));
}

/** Basis points that add up to 10000, as a random cut of the whole. */
function randomBasisPoints(next: () => number, n: number): number[] {
	const cuts = Array.from({ length: n - 1 }, () =>
		Math.floor(next() * 10001),
	).sort((a, b) => a - b);
	const bounds = [0, ...cuts, 10000];
	return bounds.slice(1).map((b, i) => b - bounds[i]!);
}

function minorOf(shareAmount: number, currency: string): bigint {
	return BigInt(toMinorUnits(shareAmount, currency));
}

describe("resolveSplits is exact in integer minor units", () => {
	it("PERCENTAGE: every share is floor(total * bp / 10000) plus the leftover rule", () => {
		const next = rng(1);
		for (let round = 0; round < ROUNDS; round++) {
			const currency = CURRENCIES[Math.floor(next() * CURRENCIES.length)]!;
			const total = randomTotal(next);
			const n = 2 + Math.floor(next() * 11);
			const bps = randomBasisPoints(next, n);
			const refs = people(n);
			const payerIdx = Math.floor(next() * (n + 1)) - 1; // -1: outside
			const paidBy =
				payerIdx >= 0
					? refs[payerIdx]!
					: { participantType: "user" as const, participantId: "outside" };

			const splits = resolveSplits({
				mode: "PERCENTAGE",
				amount: fromMinorUnits(Number(total), currency),
				currency,
				participants: refs.map((r, i) => ({
					...r,
					sharePercentage: bps[i]! / 100,
				})),
				paidBy,
			});

			const expected = reference(
				total,
				bps.map(BigInt),
				leftoverIndex(n, payerIdx),
			);
			const context = `round ${round} ${currency} total ${total} bps ${bps} payer ${payerIdx}`;
			expect(
				splits.map((s) => minorOf(s.shareAmount, currency)),
				context,
			).toEqual(expected);
			expect(
				splits.reduce((s, x) => s + minorOf(x.shareAmount, currency), 0n),
				context,
			).toBe(total);
			expect(
				splits.map((s) => s.sharePercentage),
				context,
			).toEqual(bps.map((b) => b / 100));
		}
	});

	it("SHARES: every share is floor(total * units / all units) plus the leftover rule", () => {
		const next = rng(2);
		for (let round = 0; round < ROUNDS; round++) {
			const currency = CURRENCIES[Math.floor(next() * CURRENCIES.length)]!;
			const total = randomTotal(next);
			const n = 2 + Math.floor(next() * 11);
			const units = Array.from(
				{ length: n },
				() => 1 + Math.floor(next() * 10 ** Math.floor(1 + next() * 6)),
			);
			const refs = people(n);
			const payerIdx = Math.floor(next() * (n + 1)) - 1;
			const paidBy =
				payerIdx >= 0
					? refs[payerIdx]!
					: { participantType: "user" as const, participantId: "outside" };

			const splits = resolveSplits({
				mode: "SHARES",
				amount: fromMinorUnits(Number(total), currency),
				currency,
				participants: refs.map((r, i) => ({ ...r, shareUnits: units[i]! })),
				paidBy,
			});

			const expected = reference(
				total,
				units.map(BigInt),
				leftoverIndex(n, payerIdx),
			);
			const context = `round ${round} ${currency} total ${total} units ${units} payer ${payerIdx}`;
			expect(
				splits.map((s) => minorOf(s.shareAmount, currency)),
				context,
			).toEqual(expected);
		}
	});

	it("EQUAL: base share for all, one extra unit each to the payer first, then in row order", () => {
		const next = rng(3);
		for (let round = 0; round < ROUNDS; round++) {
			const currency = CURRENCIES[Math.floor(next() * CURRENCIES.length)]!;
			const total = randomTotal(next);
			const n = 2 + Math.floor(next() * 11);
			const refs = people(n);
			const payerIdx = Math.floor(next() * (n + 1)) - 1;
			const paidBy =
				payerIdx >= 0
					? refs[payerIdx]!
					: { participantType: "user" as const, participantId: "outside" };

			const splits = resolveSplits({
				mode: "EQUAL",
				amount: fromMinorUnits(Number(total), currency),
				currency,
				participants: refs,
				paidBy,
			});

			const base = total / BigInt(n);
			let extra = Number(total - base * BigInt(n));
			const expected = refs.map(() => base);
			if (extra > 0 && payerIdx >= 0) {
				expected[payerIdx] = expected[payerIdx]! + 1n;
				extra -= 1;
			}
			for (let i = 0; i < n && extra > 0; i++) {
				if (i === payerIdx) continue;
				expected[i] = expected[i]! + 1n;
				extra -= 1;
			}
			const context = `round ${round} ${currency} total ${total} n ${n} payer ${payerIdx}`;
			expect(
				splits.map((s) => minorOf(s.shareAmount, currency)),
				context,
			).toEqual(expected);
		}
	});

	it("EXACT: accepts rows that add up to the total in minor units, near 1e13", () => {
		const next = rng(4);
		for (let round = 0; round < 500; round++) {
			const currency = CURRENCIES[Math.floor(next() * CURRENCIES.length)]!;
			const total = randomTotal(next);
			const n = 2 + Math.floor(next() * 11);
			const weights = randomBasisPoints(next, n).map(BigInt);
			const parts = reference(total, weights, n - 1);
			const participants: SplitParticipantInput[] = people(n).map((r, i) => ({
				...r,
				shareAmount: fromMinorUnits(Number(parts[i]), currency),
			}));
			const splits = resolveSplits({
				mode: "EXACT",
				amount: fromMinorUnits(Number(total), currency),
				currency,
				participants,
				paidBy: participants[0]!,
			});
			expect(splits.map((s) => minorOf(s.shareAmount, currency))).toEqual(
				parts,
			);
		}
	});
});

describe("float failures the old math had", () => {
	it("$820.00 split 0.15% / 99.85% gives the second person $818.77, not $818.76", () => {
		// 100 - 0.15 is 99.85000000000001 in floats, and 82000 * 99.85 / 100
		// floors a cent low (81876), which then went to the payer.
		const [alice, bob] = people(2) as [
			SplitParticipantRef,
			SplitParticipantRef,
		];
		const splits = resolveSplits({
			mode: "PERCENTAGE",
			amount: 820,
			currency: "USD",
			participants: [
				{ ...alice, sharePercentage: 0.15 },
				{ ...bob, sharePercentage: 99.85 },
			],
			paidBy: alice,
		});
		expect(splits.map((s) => s.shareAmount)).toEqual([1.23, 818.77]);
		expect(splits[1]!.sharePercentage).toBe(99.85);
	});

	it("a 50.01 / 49.99 split of $1,000.00 is exact", () => {
		const [alice, bob] = people(2) as [
			SplitParticipantRef,
			SplitParticipantRef,
		];
		const splits = resolveSplits({
			mode: "PERCENTAGE",
			amount: 1000,
			currency: "USD",
			participants: [
				{ ...alice, sharePercentage: 50.01 },
				{ ...bob, sharePercentage: 49.99 },
			],
			paidBy: bob,
		});
		expect(splits.map((s) => s.shareAmount)).toEqual([500.1, 499.9]);
	});

	it("shares stay exact where total * units passes 2^53", () => {
		// 9694453255739 * 975 is about 9.5e15; the float product rounded the last
		// share down a unit and the payer absorbed one unit too many.
		const [alice, bob, carol] = people(3) as [
			SplitParticipantRef,
			SplitParticipantRef,
			SplitParticipantRef,
		];
		const splits = resolveSplits({
			mode: "SHARES",
			amount: 96944532557.39,
			currency: "USD",
			participants: [
				{ ...alice, shareUnits: 215 },
				{ ...bob, shareUnits: 721 },
				{ ...carol, shareUnits: 975 },
			],
			paidBy: alice,
		});
		expect(splits.map((s) => minorOf(s.shareAmount, "USD"))).toEqual([
			1090689403446n,
			3657614232018n,
			4946149620275n,
		]);
	});
});

describe("allocateByWeights", () => {
	it("floors each weight's share and gives the leftover to the chosen row", () => {
		expect(allocateByWeights(10000, [10, 1], 0)).toEqual([9091, 909]);
		expect(allocateByWeights(10000, [10, 1], 1)).toEqual([9090, 910]);
	});

	it("refuses totals and weights it cannot hold exactly", () => {
		expect(() => allocateByWeights(2 ** 60, [1, 1], 0)).toThrow("too large");
		expect(() => allocateByWeights(100, [1.5, 1], 0)).toThrow("whole numbers");
		expect(() => allocateByWeights(100, [0, 0], 0)).toThrow("more than 0");
	});
});

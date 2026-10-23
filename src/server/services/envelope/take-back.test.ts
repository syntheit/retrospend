/**
 * Taking money back to To assign from next month (D22) must never create
 * money: next month's Left includes this month's projected carry, which To
 * assign already counts. Property: across random sequences of assigns,
 * take-backs, moves and spending, every take-back the cap allows keeps
 * Assigned(c+1) >= 0, so ToAssign(c) + Σ Left(e, c) never exceeds the ledger.
 */
import { describe, expect, it } from "vitest";
import {
	type ActivityEntry,
	computeBook,
	type EngineInput,
	invariantSides,
	type MovementEntry,
} from "./engine";
import { takeBackCap } from "./planning";

const C = 202610;
const NEXT = 202611;
const ENVELOPES = ["a", "b", "c"];

function input(
	movements: MovementEntry[],
	activity: ActivityEntry[],
): EngineInput {
	return {
		startMonth: C,
		currentMonth: C,
		defaultEnvelopeId: "a",
		envelopes: ENVELOPES.map((id) => ({
			id,
			kind: "MONTHLY",
			leftoverRule: "CARRY",
			sweepToId: null,
			categoryIds: [],
		})),
		moneyIn: [{ id: "in", month: C, minor: 10_000, source: "INCOME" }],
		activity,
		movements,
		splits: [],
	};
}

function capFor(i: EngineInput, envelopeId: string, month: number) {
	const s = computeBook(i);
	const row = s.month(month).envelopes.get(envelopeId);
	return takeBackCap({
		month,
		currentMonth: C,
		left: row?.left ?? 0,
		assigned: row?.assigned ?? 0,
		poolAssigned: s.month(month).totals.assigned,
	});
}

/** Small deterministic PRNG (mulberry32), so a failure is reproducible from its seed. */
function rng(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

describe("take-back from next month (review finding 1)", () => {
	it("income 100, 100 to E this month, take 100 back from E next month: refused", () => {
		const i = input(
			[{ id: "m1", month: C, from: null, to: "a", minor: 10_000 }],
			[],
		);
		// Next month's Left is the 100 carried in; none of it was assigned there.
		expect(capFor(i, "a", NEXT)).toBe(0);
		// This month the 100 is assigned here and can come back.
		expect(capFor(i, "a", C)).toBe(10_000);
	});

	it("money moved into E next month from another envelope's carry cannot leave to the pool", () => {
		const i = input(
			[
				{ id: "m1", month: C, from: null, to: "b", minor: 5_000 },
				{ id: "m2", month: NEXT, from: "b", to: "a", minor: 5_000 },
			],
			[],
		);
		// Assigned(a, next) is 50, but nothing net came out of To assign next month.
		expect(capFor(i, "a", NEXT)).toBe(0);
	});

	it.each(Array.from({ length: 40 }, (_, k) => k + 1))(
		"random sequence %d keeps the budget within the ledger",
		(seed) => {
			const r = rng(seed);
			const movements: MovementEntry[] = [];
			const activity: ActivityEntry[] = [];
			const pick = () =>
				ENVELOPES[Math.floor(r() * ENVELOPES.length)] as string;
			for (let step = 0; step < 30; step++) {
				const month = r() < 0.5 ? C : NEXT;
				const amount = 100 + Math.floor(r() * 4_000);
				const e = pick();
				const op = r();
				const id = `s${step}`;
				if (op < 0.35)
					movements.push({ id, month, from: null, to: e, minor: amount });
				else if (op < 0.7) {
					const cap = capFor(input(movements, activity), e, month);
					if (cap > 0)
						movements.push({
							id,
							month,
							from: e,
							to: null,
							minor: Math.min(cap, amount),
						});
				} else if (op < 0.9) {
					const s = computeBook(input(movements, activity));
					const cap = Math.max(0, s.month(month).envelopes.get(e)?.left ?? 0);
					const to = pick();
					if (cap > 0 && to !== e)
						movements.push({
							id,
							month,
							from: e,
							to,
							minor: Math.min(cap, amount),
						});
				} else
					activity.push({
						id,
						month: C,
						date: "2026-10-15",
						minor: -amount,
						source: "SPENT",
						categoryId: null,
						envelopeId: e,
					});
				const i = input(movements, activity);
				const state = computeBook(i);
				const sides = invariantSides(i, state);
				expect(sides.budget).toBe(sides.ledger);
				const nextAssigned = state.month(NEXT).totals.assigned;
				expect(nextAssigned).toBeGreaterThanOrEqual(0);
				const shown = sides.budget - nextAssigned;
				expect(shown).toBeLessThanOrEqual(sides.ledger);
			}
		},
	);
});

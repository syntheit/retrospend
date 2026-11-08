/**
 * The device's checkpoint cache against a full pass. A ten-month ARS book
 * (minor units, millions of pesos), edited at random, one edit at a time:
 * after every edit a pass through the cache must give the numbers of a pass
 * from the start, from the first month it computes to next month.
 *
 * Own rows (spending, movements, income) tell the cache with markDirty, as
 * the local store will; shares and splits effects do not, the fingerprint
 * catches them. The control test shows the guard is what keeps it honest.
 */
import { describe, expect, it } from "vitest";
import { BudgetCheckpointCache } from "./budget-cache";
import {
	type ActivityEntry,
	computeBook,
	type EngineEnvelope,
	type EngineInput,
	type MoneyInEntry,
	type MovementEntry,
} from "./engine";
import { monthsFrom } from "./months";
import type { ReplayEffect } from "./splits-replay";
import type { MissingRate } from "./types";

const START = 202601;
const CURRENT = 202610;
const CLOSED = monthsFrom(START, 202609);

const env = (
	id: string,
	kind: EngineEnvelope["kind"] = "MONTHLY",
	rule: EngineEnvelope["leftoverRule"] = "CARRY",
): EngineEnvelope => ({
	id,
	kind,
	leftoverRule: rule,
	sweepToId: null,
	categoryIds: [`c-${id}`],
});

// A tiny deterministic generator (LCG): same book, same edits, every run.
function rng(seed: number) {
	let s = seed;
	return (n: number) => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s % n;
	};
}

// A cheap stable hash standing in for what a device would use.
const hash = (s: string) => {
	let h = 5381;
	for (let i = 0; i < s.length; i++)
		h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
	return `${s.length}:${h}`;
};

const month = (i: number) => CLOSED.concat(CURRENT)[i] as number;
const dateOf = (m: number) =>
	`${Math.floor(m / 100)}-${String(m % 100).padStart(2, "0")}-10`;

function book(seed: number) {
	const r = rng(seed);
	let n = 0;
	const id = (p: string) => `${p}${n++}`;
	const envelopes = [
		env("food"),
		env("rent"),
		env("fun", "MONTHLY", "RETURN"),
		env("save", "SAVINGS"),
		env("else"),
	];
	const moneyIn: MoneyInEntry[] = [
		{
			id: "start",
			month: START,
			minor: 900_000_000,
			source: "STARTING_BALANCE",
		},
	];
	const movements: MovementEntry[] = [];
	const activity: ActivityEntry[] = [];
	const splits: ReplayEffect[] = [];
	for (let i = 0; i < 10; i++) {
		const m = month(i);
		moneyIn.push({
			id: id("in"),
			month: m,
			minor: 250_000_000,
			source: "INCOME",
		});
		for (const to of ["food", "rent", "fun", "save"])
			movements.push({
				id: id("mv"),
				month: m,
				from: null,
				to,
				minor: 5_000_000 + r(40_000_000),
			});
		for (let k = 0; k < 4 + r(5); k++) {
			const cat = ["c-food", "c-rent", "c-fun", null][r(4)] ?? null;
			activity.push(spend(id("e"), m, 10_000 + r(60_000_000), cat));
		}
	}
	return { envelopes, moneyIn, movements, activity, splits, r, id };
}

function spend(
	id: string,
	m: number,
	minor: number,
	cat: string | null,
	source: ActivityEntry["source"] = "SPENT",
): ActivityEntry {
	return {
		id,
		month: m,
		date: dateOf(m),
		minor: -minor,
		source,
		categoryId: cat,
	};
}

type Book = ReturnType<typeof book>;

const inputOf = (b: Book): EngineInput => ({
	startMonth: START,
	currentMonth: CURRENT,
	defaultEnvelopeId: "else",
	envelopes: b.envelopes,
	moneyIn: b.moneyIn,
	activity: b.activity,
	movements: b.movements,
	splits: b.splits,
});

function sameAsFull(
	input: EngineInput,
	cache: BudgetCheckpointCache,
): number | null {
	const via = cache.run(input, { closedMonths: CLOSED });
	const full = computeBook(input);
	for (
		let m = via.state.firstMonth;
		m <= CURRENT + 1;
		m = m % 100 === 12 ? m + 89 : m + 1
	) {
		expect(via.state.toAssign(m)).toEqual(full.toAssign(m));
		expect([...via.state.month(m).envelopes.values()]).toEqual([
			...full.month(m).envelopes.values(),
		]);
	}
	return via.startedAt;
}

describe("BudgetCheckpointCache", () => {
	it("a cold pass runs from the start, a warm one from the checkpoint before the last closed month", () => {
		const input = inputOf(book(7));
		const cache = new BudgetCheckpointCache(hash);
		expect(sameAsFull(input, cache)).toBeNull();
		expect(cache.months).toEqual(CLOSED);
		expect(sameAsFull(input, cache)).toBe(202608);
	});

	it("matches a full pass through sixty random edits", () => {
		const b = book(42);
		const cache = new BudgetCheckpointCache(hash);
		let warm = 0;
		for (let step = 0; step < 60; step++) {
			const m = month(b.r(10));
			const kind = b.r(8);
			if (kind === 0) {
				b.activity.push(
					spend(b.id("e"), m, 10_000 + b.r(90_000_000), "c-food"),
				);
				cache.markDirty(m);
			} else if (kind === 1 && b.activity.length > 20) {
				const at = b.r(b.activity.length);
				const [gone] = b.activity.splice(at, 1);
				if (gone) cache.markDirty(gone.month);
			} else if (kind === 2) {
				const at = b.r(b.movements.length);
				const mv = b.movements[at] as MovementEntry;
				b.movements[at] = { ...mv, minor: mv.minor + 1 + b.r(9_000_000) };
				cache.markDirty(mv.month);
			} else if (kind === 3) {
				b.moneyIn.push({
					id: b.id("in"),
					month: m,
					minor: 1 + b.r(80_000_000),
					source: "INCOME",
				});
				cache.markDirty(m);
			} else if (kind === 4) {
				b.activity.push(
					spend(b.id("sh"), m, 1 + b.r(5_000_000), "c-food", "SHARE"),
				);
			} else if (kind === 5) {
				const shares = b.activity.filter((a) => a.source === "SHARE");
				const pick = shares[b.r(shares.length || 1)];
				if (pick) pick.minor -= 1 + b.r(1_000_000);
			} else if (kind === 6) {
				b.splits.push({
					eventId: b.id("sp"),
					date: dateOf(m),
					month: m,
					counterparty: "user:juan",
					currency: "ARS",
					term: "FRONTED",
					minor: 1 + b.r(3_000_000),
					fx: 0,
				});
			}
			// kind 7: a plain re-read.
			if (sameAsFull(inputOf(b), cache) !== null) warm++;
		}
		// The cache did its job in most steps, not just match by recomputing.
		expect(warm).toBeGreaterThan(20);
	});

	it("without markDirty, an edit before the checkpoint is missed: the guard is what keeps it right", () => {
		const b = book(3);
		const cache = new BudgetCheckpointCache(hash);
		cache.run(inputOf(b), { closedMonths: CLOSED });
		// A 1,000,000.00 ARS refund-sized income in March, own row, no mark.
		b.moneyIn.push({
			id: "late",
			month: 202603,
			minor: 100_000_000,
			source: "INCOME",
		});
		const stale = cache.run(inputOf(b), { closedMonths: CLOSED });
		const full = computeBook(inputOf(b));
		expect(stale.startedAt).toBe(202608);
		expect(stale.state.toAssign(CURRENT)).not.toEqual(full.toAssign(CURRENT));
		// With the mark the cache drops every checkpoint from March and agrees.
		cache.markDirty(202603);
		expect(sameAsFull(inputOf(b), cache)).toBe(202602);
	});

	it("a share edited after the checkpoint is caught by the fingerprint, with no mark", () => {
		const b = book(5);
		b.activity.push(spend("sh-1", 202604, 2_500_000, "c-food", "SHARE"));
		const cache = new BudgetCheckpointCache(hash);
		cache.run(inputOf(b), { closedMonths: CLOSED });
		const sh = b.activity.find((a) => a.id === "sh-1") as ActivityEntry;
		sh.minor = -9_900_000;
		// Checkpoints from April on fail their print; March's still stands.
		expect(sameAsFull(inputOf(b), cache)).toBe(202603);
		// That pass replaced them, so the next one starts late again, not at March.
		expect(sameAsFull(inputOf(b), cache)).toBe(202608);
	});

	it("a rate missing behind the checkpoint is still reported when only later rows are passed", () => {
		const b = book(9);
		const missing: MissingRate = {
			currency: "USD",
			rateType: "official",
			date: "2026-03-10",
			rowId: "usd-march",
		};
		// The device values rows as it loads them: a month's checkpoint carries
		// the missing rates of rows dated up to it.
		const through = (m: number) => (m >= 202603 ? [missing] : []);
		const cache = new BudgetCheckpointCache(hash);
		const cold = cache.run(inputOf(b), {
			closedMonths: CLOSED,
			missingThrough: through,
		});
		expect(cold.startedAt).toBeNull();
		expect(cold.missingRates).toEqual([]);
		// Warm pass at the August checkpoint; the device loads only later rows,
		// so its own valuation finds nothing missing.
		const later = {
			...inputOf(b),
			activity: b.activity.filter((a) => a.month > 202608),
		};
		const warm = cache.run(later, {
			closedMonths: CLOSED,
			missingThrough: through,
		});
		expect(warm.startedAt).toBe(202608);
		expect(warm.missingRates).toEqual([missing]);
	});
});

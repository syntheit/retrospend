import { describe, expect, it } from "vitest";
import type { Money } from "~/server/figures/registry";
import { diffSnapshots, moneyDelta, type Snapshot } from "./diff";

const ars = (minor: number): Money => ({ minor, currency: "ARS" });
const usd = (minor: number): Money => ({ minor, currency: "USD" });
const snap = (entries: [string, Money | null][]): Snapshot => new Map(entries);

describe("diffSnapshots", () => {
	it("lists every figure as unchanged when nothing moved", () => {
		const before = snap([
			["owed.owedToYou", ars(14_427_500)],
			["netWorth", ars(100_000_000)],
		]);
		const after = snap([
			["owed.owedToYou", ars(14_427_500)],
			["netWorth", ars(100_000_000)],
		]);

		expect(diffSnapshots(before, after)).toEqual({
			changes: [],
			unchanged: [
				{ id: "owed.owedToYou", value: ars(14_427_500) },
				{ id: "netWorth", value: ars(100_000_000) },
			],
		});
	});

	it("reports a change with its delta in minor units", () => {
		const diff = diffSnapshots(
			snap([["owed.owedToYou", ars(14_427_500)]]),
			snap([["owed.owedToYou", ars(0)]]),
		);

		expect(diff.changes).toEqual([
			{
				id: "owed.owedToYou",
				before: ars(14_427_500),
				after: ars(0),
				delta: ars(-14_427_500),
			},
		]);
		expect(diff.unchanged).toEqual([]);
	});

	it("keeps the delta exact when a balance flips sign", () => {
		const diff = diffSnapshots(
			snap([["balance.withPerson", ars(500)]]),
			snap([["balance.withPerson", ars(-300)]]),
		);

		expect(diff.changes[0]?.delta).toEqual(ars(-800));
	});

	it("reports a currency switch as a change with no delta, never converting", () => {
		const diff = diffSnapshots(
			snap([["netWorth", ars(100)]]),
			snap([["netWorth", usd(100)]]),
		);

		expect(diff.changes).toEqual([
			{ id: "netWorth", before: ars(100), after: usd(100), delta: null },
		]);
	});

	it("reports a figure that became unavailable as a change", () => {
		const diff = diffSnapshots(
			snap([["netWorth", ars(100)]]),
			snap([["netWorth", null]]),
		);

		expect(diff.changes).toEqual([
			{ id: "netWorth", before: ars(100), after: null, delta: null },
		]);
	});

	it("does not drop a figure missing from one snapshot", () => {
		const diff = diffSnapshots(
			snap([["owed.youOwe", ars(5)]]),
			snap([["spent", ars(7)]]),
		);

		expect(diff.changes).toEqual([
			{ id: "owed.youOwe", before: ars(5), after: null, delta: null },
			{ id: "spent", before: null, after: ars(7), delta: null },
		]);
	});

	it("treats a figure unavailable on both sides as unchanged", () => {
		expect(
			diffSnapshots(snap([["netWorth", null]]), snap([["netWorth", null]])),
		).toEqual({ changes: [], unchanged: [{ id: "netWorth", value: null }] });
	});
});

describe("moneyDelta", () => {
	it("refuses a delta outside the safe integer range", () => {
		expect(() =>
			moneyDelta(ars(-Number.MAX_SAFE_INTEGER), ars(Number.MAX_SAFE_INTEGER)),
		).toThrow(RangeError);
	});
});

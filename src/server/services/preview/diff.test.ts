import { describe, expect, it } from "vitest";
import type { FigureReading, Money } from "~/server/figures/registry";
import { diffSnapshots, moneyDelta, type Snapshot } from "./diff";

const ars = (minor: number): Money => ({ minor, currency: "ARS" });
const usd = (minor: number): Money => ({ minor, currency: "USD" });
const snap = (entries: [string, FigureReading][]): Snapshot => new Map(entries);

describe("diffSnapshots", () => {
	it("lists every figure as unchanged when nothing moved", () => {
		const before = snap([
			["owed.owedToYou", [ars(14_427_500)]],
			["netWorth", [ars(100_000_000)]],
		]);
		const after = snap([
			["owed.owedToYou", [ars(14_427_500)]],
			["netWorth", [ars(100_000_000)]],
		]);

		expect(diffSnapshots(before, after)).toEqual({
			changes: [],
			unchanged: [
				{ id: "owed.owedToYou", value: [ars(14_427_500)] },
				{ id: "netWorth", value: [ars(100_000_000)] },
			],
			unavailable: [],
		});
	});

	it("reports a change with its delta in minor units", () => {
		const diff = diffSnapshots(
			snap([["owed.owedToYou", [ars(14_427_500)]]]),
			snap([["owed.owedToYou", [ars(0)]]]),
		);

		expect(diff.changes).toEqual([
			{
				id: "owed.owedToYou",
				currency: "ARS",
				before: ars(14_427_500),
				after: ars(0),
				delta: ars(-14_427_500),
				figureAfter: [ars(0)],
			},
		]);
		expect(diff.unchanged).toEqual([]);
	});

	it("keeps the delta exact when a balance flips sign", () => {
		const diff = diffSnapshots(
			snap([["balance.withPerson", [ars(500)]]]),
			snap([["balance.withPerson", [ars(-300)]]]),
		);

		expect(diff.changes[0]?.delta).toEqual(ars(-800));
	});

	it("reports a currency that appears, with the missing side null", () => {
		const diff = diffSnapshots(
			snap([["balance.withPerson", [ars(500)]]]),
			snap([["balance.withPerson", [ars(500), usd(2_000)]]]),
		);

		expect(diff.changes).toEqual([
			{
				id: "balance.withPerson",
				currency: "USD",
				before: null,
				after: usd(2_000),
				delta: usd(2_000),
				figureAfter: [ars(500), usd(2_000)],
			},
		]);
	});

	it("reports a currency that disappears, with the missing side null", () => {
		const diff = diffSnapshots(
			snap([["balance.withPerson", [ars(500), usd(2_000)]]]),
			snap([["balance.withPerson", [ars(500)]]]),
		);

		expect(diff.changes).toEqual([
			{
				id: "balance.withPerson",
				currency: "USD",
				before: usd(2_000),
				after: null,
				delta: usd(-2_000),
				figureAfter: [ars(500)],
			},
		]);
	});

	it("reports only the currency that moved, with every line it now holds", () => {
		const diff = diffSnapshots(
			snap([["balance.withPerson", [ars(500), usd(2_000)]]]),
			snap([["balance.withPerson", [ars(0), usd(2_000)]]]),
		);

		expect(diff.changes).toEqual([
			{
				id: "balance.withPerson",
				currency: "ARS",
				before: ars(500),
				after: ars(0),
				delta: ars(-500),
				figureAfter: [ars(0), usd(2_000)],
			},
		]);
		expect(diff.unchanged).toEqual([]);
	});

	it("treats a missing currency line and a zero line as the same amount", () => {
		const diff = diffSnapshots(
			snap([["balance.withPerson", [ars(500)]]]),
			snap([["balance.withPerson", [ars(500), usd(0)]]]),
		);

		expect(diff.changes).toEqual([]);
		expect(diff.unchanged).toEqual([
			{ id: "balance.withPerson", value: [ars(500), usd(0)] },
		]);
	});

	it("lists changed currencies in code order", () => {
		const diff = diffSnapshots(
			snap([["netWorth", [usd(1)]]]),
			snap([["netWorth", [ars(1)]]]),
		);

		expect(diff.changes.map((c) => c.currency)).toEqual(["ARS", "USD"]);
	});

	it("never nets one currency against another", () => {
		const diff = diffSnapshots(
			snap([["netWorth", [ars(100)]]]),
			snap([["netWorth", [usd(100)]]]),
		);

		expect(diff.changes.map((c) => [c.currency, c.delta])).toEqual([
			["ARS", ars(-100)],
			["USD", usd(100)],
		]);
	});

	it("lists a figure that became unavailable on its own, not as a change", () => {
		const diff = diffSnapshots(
			snap([["netWorth", [ars(100)]]]),
			snap([["netWorth", null]]),
		);

		expect(diff).toEqual({
			changes: [],
			unchanged: [],
			unavailable: [{ id: "netWorth", before: [ars(100)], after: null }],
		});
	});

	it("does not drop a figure missing from one snapshot", () => {
		const diff = diffSnapshots(
			snap([["owed.youOwe", [ars(5)]]]),
			snap([["spent", [ars(7)]]]),
		);

		expect(diff.unavailable).toEqual([
			{ id: "owed.youOwe", before: [ars(5)], after: null },
			{ id: "spent", before: null, after: [ars(7)] },
		]);
	});

	it("keeps an empty figure that stayed empty as unchanged", () => {
		expect(
			diffSnapshots(snap([["owed.youOwe", []]]), snap([["owed.youOwe", []]])),
		).toEqual({
			changes: [],
			unchanged: [{ id: "owed.youOwe", value: [] }],
			unavailable: [],
		});
	});
});

describe("moneyDelta", () => {
	it("refuses a delta outside the safe integer range", () => {
		expect(() =>
			moneyDelta(
				"ARS",
				ars(-Number.MAX_SAFE_INTEGER),
				ars(Number.MAX_SAFE_INTEGER),
			),
		).toThrow(RangeError);
	});
});

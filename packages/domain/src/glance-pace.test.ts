import { describe, expect, it } from "vitest";
import {
	cumulativeMinor,
	runningHome,
	daysBetween,
	fasterThanLast,
	missingIn,
	spanOf,
} from "./glance-pace";
import type { MoneyItemDec } from "./money-dec";
import { dec } from "./precise-decimal";

const ars = (amount: number, amountInUSD: number): MoneyItemDec => ({
	currency: "ARS",
	amount: dec(amount),
	amountInUSD: dec(amountInUSD),
});
const usd = (amount: number): MoneyItemDec => ({
	currency: "USD",
	amount: dec(amount),
	amountInUSD: dec(amount),
});
/** An unpriced item: no rate at all when it was loaded. */
const unpriced = (currency: string, amount: number): MoneyItemDec => ({
	currency,
	amount: dec(amount),
	amountInUSD: null,
});
const text = (values: readonly { toFixed(): string }[] | null | undefined) =>
	values?.map((d) => d.toFixed());

describe("glance pace", () => {
	const oct = spanOf("2026-10-01", "2026-10-31");

	it("periods count their calendar days", () => {
		expect(oct.days).toBe(31);
		expect(spanOf("2026-02-15", "2026-03-14").days).toBe(28);
		expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
	});

	it("totals rows up to each day in the home currency (USD 10 at ARS 1,355 = ARS 13,550)", () => {
		const running = runningHome(
			[
				{ day: "2026-10-01", item: ars(1000, 0.74) },
				{ day: "2026-10-01", item: usd(10) },
				{ day: "2026-10-03", item: ars(-200, -0.15) },
				{ day: "2026-09-30", item: ars(999, 0.74) },
			],
			oct,
			"ARS",
			1355,
		);
		// Day 1: 1,000 + 13,550 = 14,550. Day 2: nothing new. Day 3: less the
		// 200 refund = 14,350. The Sep 30 row is outside the span.
		expect(text(running?.slice(0, 3))).toEqual(["14550", "14550", "14350"]);
		expect(running?.length).toBe(31);
	});

	it("a booked home value wins over today's rate (M2)", () => {
		const running = runningHome(
			[
				{
					day: "2026-10-02",
					item: {
						...usd(10),
						booked: { currency: "ARS", amount: dec(12_000) },
					},
				},
			],
			oct,
			"ARS",
			1355,
		);
		expect(running?.[1]?.toFixed()).toBe("12000");
	});

	it("names every currency that keeps a period out: the home rate and unpriced shares", () => {
		const rows = [
			{ day: "2026-10-02", item: usd(10) },
			{ day: "2026-10-03", item: unpriced("ISK", 900) },
			{ day: "2026-10-04", item: unpriced("CLF", 1) },
			{ day: "2026-09-04", item: unpriced("PYG", 1) },
		];
		expect(missingIn(rows, oct, "ARS", null)).toEqual(["ARS", "CLF", "ISK"]);
		expect(missingIn(rows, oct, "ARS", 1355)).toEqual(["CLF", "ISK"]);
		expect(runningHome(rows, oct, "ARS", 1355)).toBeNull();
		// An unpriced share in the home currency itself still counts as entered.
		expect(missingIn(rows.slice(1, 2), oct, "ISK", null)).toEqual([]);
		expect(
			runningHome(rows.slice(1, 2), oct, "ISK", null)?.[2]?.toFixed(),
		).toBe("900");
	});

	it("a foreign row with no home rate makes the whole period unavailable, never 1", () => {
		expect(
			runningHome([{ day: "2026-10-02", item: usd(10) }], oct, "ARS", null),
		).toBeNull();
		// Rows already in the home currency still total without a rate.
		expect(
			runningHome(
				[{ day: "2026-10-02", item: ars(500, 0.37) }],
				oct,
				"ARS",
				null,
			)?.[1]?.toFixed(),
		).toBe("500");
	});

	it("each running total rounds once to minor units, half to even", () => {
		// 0.105 is a tie at cents: half to even gives 0.10 (10), not 0.11.
		// 0.21 is 21; day 3 holds at 21; day 4 is cut off by upTo.
		expect(
			cumulativeMinor(
				[dec("0.105"), dec("0.21"), dec("0.21"), dec("1.21")],
				3,
				"USD",
			),
		).toEqual([10, 21, 21]);
		// 0.005 is a tie (0, even); 0.015 is a tie too (2, even).
		expect(cumulativeMinor([dec("0.005"), dec("0.015")], 2, "USD")).toEqual([
			0, 2,
		]);
		expect(
			cumulativeMinor([dec(1000), dec(1000), dec(1250)], 31, "ARS"),
		).toEqual([100_000, 100_000, 125_000]);
	});

	it("faster only when more than 3% ahead of last period by the same day", () => {
		expect(fasterThanLast(103_000, 100_000)).toBe(false);
		expect(fasterThanLast(103_001, 100_000)).toBe(true);
		expect(fasterThanLast(50, 100)).toBe(false);
		expect(fasterThanLast(500, 0)).toBeNull();
	});
});

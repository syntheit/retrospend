import { describe, expect, it } from "vitest";
import {
	cumulativeMinor,
	dailyHome,
	daysBetween,
	fasterThanLast,
	missingIn,
	spanOf,
} from "./glance-pace";

const ars = (amount: number, amountInUSD: number) => ({
	currency: "ARS",
	amount,
	amountInUSD,
});
const usd = (amount: number) => ({
	currency: "USD",
	amount,
	amountInUSD: amount,
});

describe("glance pace", () => {
	const oct = spanOf("2026-10-01", "2026-10-31");

	it("periods count their calendar days", () => {
		expect(oct.days).toBe(31);
		expect(spanOf("2026-02-15", "2026-03-14").days).toBe(28);
		expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
	});

	it("buckets rows per day in the home currency (USD 10 at ARS 1,355 = ARS 13,550)", () => {
		const daily = dailyHome(
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
		expect(daily?.slice(0, 3)).toEqual([14_550, 0, -200]);
		expect(daily?.length).toBe(31);
	});

	it("a booked home value wins over today's rate (M2)", () => {
		const daily = dailyHome(
			[
				{
					day: "2026-10-02",
					item: { ...usd(10), booked: { currency: "ARS", amount: 12_000 } },
				},
			],
			oct,
			"ARS",
			1355,
		);
		expect(daily?.[1]).toBe(12_000);
	});

	it("names every currency that keeps a period out: the home rate and unpriced shares", () => {
		const rows = [
			{ day: "2026-10-02", item: usd(10) },
			{
				day: "2026-10-03",
				item: { currency: "ISK", amount: 900, amountInUSD: Number.NaN },
			},
			{
				day: "2026-10-04",
				item: { currency: "CLF", amount: 1, amountInUSD: Number.NaN },
			},
			{
				day: "2026-09-04",
				item: { currency: "PYG", amount: 1, amountInUSD: Number.NaN },
			},
		];
		expect(missingIn(rows, oct, "ARS", null)).toEqual(["ARS", "CLF", "ISK"]);
		expect(missingIn(rows, oct, "ARS", 1355)).toEqual(["CLF", "ISK"]);
		expect(dailyHome(rows, oct, "ARS", 1355)).toBeNull();
		// An unpriced share in the home currency itself still counts as entered.
		expect(missingIn(rows.slice(1, 2), oct, "ISK", null)).toEqual([]);
		expect(dailyHome(rows.slice(1, 2), oct, "ISK", null)?.[2]).toBe(900);
	});

	it("a foreign row with no home rate makes the whole period unavailable, never 1", () => {
		expect(
			dailyHome([{ day: "2026-10-02", item: usd(10) }], oct, "ARS", null),
		).toBeNull();
		// Rows already in the home currency still total without a rate.
		expect(
			dailyHome(
				[{ day: "2026-10-02", item: ars(500, 0.37) }],
				oct,
				"ARS",
				null,
			)?.[1],
		).toBe(500);
	});

	it("running totals round once per day to minor units", () => {
		// 0.105 + 0.105 = 0.21 exactly at the cents level once summed.
		expect(cumulativeMinor([0.105, 0.105, 0, 1], 3, "USD")).toEqual([
			10, 21, 21,
		]);
		expect(cumulativeMinor([1000, 0, 250], 31, "ARS")).toEqual([
			100_000, 100_000, 125_000,
		]);
	});

	it("faster only when more than 3% ahead of last period by the same day", () => {
		expect(fasterThanLast(103_000, 100_000)).toBe(false);
		expect(fasterThanLast(103_001, 100_000)).toBe(true);
		expect(fasterThanLast(50, 100)).toBe(false);
		expect(fasterThanLast(500, 0)).toBeNull();
	});
});

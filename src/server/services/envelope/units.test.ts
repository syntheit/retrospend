import { describe, expect, it } from "vitest";
import {
	addDays,
	addMonths,
	addMonthsToDate,
	dayOfWeek,
	daysBetween,
	monthsBetween,
} from "./calendar";
import {
	ceilDiv,
	fromMinor,
	mulDiv,
	percentOf,
	ratioBp,
	sumMinor,
	toMinor,
} from "./units";

describe("toMinor rounds half-even (IMPLEMENTATION §2.2)", () => {
	it.each([
		{ amount: "2.5", currency: "JPY", minor: 2 },
		{ amount: "3.5", currency: "JPY", minor: 4 },
		{ amount: "-2.5", currency: "JPY", minor: -2 },
		{ amount: "10.125", currency: "USD", minor: 1012 },
		{ amount: "10.135", currency: "USD", minor: 1014 },
		{ amount: "1.2345", currency: "KWD", minor: 1234 },
		{ amount: "0.000000015", currency: "BTC", minor: 2 },
		{ amount: "1000000000000", currency: "ARS", minor: 100_000_000_000_000 },
	])("$amount $currency -> $minor", ({ amount, currency, minor }) => {
		expect(toMinor(amount, currency)).toBe(minor);
	});

	it("round-trips through fromMinor", () => {
		expect(fromMinor(123_456, "USD").toString()).toBe("1234.56");
	});

	it("refuses amounts past the safe integer range", () => {
		expect(() => toMinor("100000000000000", "BTC")).toThrow(RangeError);
	});
});

describe("integer helpers", () => {
	it.each([
		{ a: 5, num: 1, den: 2, out: 2 },
		{ a: 7, num: 1, den: 2, out: 4 },
		{ a: -5, num: 1, den: 2, out: -2 },
		{ a: -7, num: 1, den: 2, out: -4 },
		{ a: 10, num: 1, den: 3, out: 3 },
		{ a: 20, num: 1, den: 3, out: 7 },
	])("mulDiv($a, $num, $den) = $out", ({ a, num, den, out }) => {
		expect(mulDiv(a, num, den)).toBe(out);
	});

	it.each([
		{ a: 120_000, b: 6, out: 20_000 },
		{ a: 100_001, b: 6, out: 16_667 },
		{ a: -100, b: 3, out: -33 },
		{ a: 0, b: 4, out: 0 },
	])("ceilDiv($a, $b) = $out", ({ a, b, out }) => {
		expect(ceilDiv(a, b)).toBe(out);
	});

	it("percentOf and ratioBp use basis points", () => {
		expect(percentOf(240_000_000, 2_000)).toBe(48_000_000);
		expect(ratioBp(31, 100)).toBe(3_100);
		expect(ratioBp(5, 0)).toBeNull();
	});

	it("sumMinor rejects floats", () => {
		expect(sumMinor([1, 2, 3])).toBe(6);
		expect(() => sumMinor([1.5])).toThrow(RangeError);
	});
});

describe("calendar", () => {
	it.each([
		{ from: 202611, n: 6, out: 202705 },
		{ from: 202601, n: -1, out: 202512 },
		{ from: 202612, n: 1, out: 202701 },
	])("addMonths($from, $n) = $out", ({ from, n, out }) => {
		expect(addMonths(from, n)).toBe(out);
		expect(monthsBetween(from, out)).toBe(n);
	});

	it.each([
		{ anchor: "2026-01-31", n: 1, out: "2026-02-28" },
		{ anchor: "2026-01-31", n: 2, out: "2026-03-31" },
		{ anchor: "2024-01-31", n: 1, out: "2024-02-29" },
		{ anchor: "2026-05-15", n: 12, out: "2027-05-15" },
	])("addMonthsToDate($anchor, $n) = $out", ({ anchor, n, out }) => {
		expect(addMonthsToDate(anchor, n)).toBe(out);
	});

	it("days and weekdays are plain calendar math", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(daysBetween("2026-10-21", "2026-10-31")).toBe(10);
		expect(dayOfWeek("2026-10-05")).toBe(1);
	});

	it.each([
		"2026-02-30",
		"2026-02-29",
		"2026-13-01",
		"2026-00-10",
		"2026-04-31",
		"2026-1-01",
	])("rejects the impossible date %s", (date) => {
		expect(() => addDays(date, 0)).toThrow(RangeError);
	});

	it("accepts February 29 in a leap year", () => {
		expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
	});
});

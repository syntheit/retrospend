import { describe, expect, it } from "vitest";
import { Dec, dec, toFloat } from "./precise-decimal";

// Decimal(19,8) tops out at 99999999999.99999999 and Decimal(18,6) rates at
// 999999999999.999999.
const AMOUNT_MAX = "99999999999.99999999";
const RATE_MAX = "999999999999.999999";

describe("precise decimal", () => {
	it("keeps the full product of a max amount and a max rate", () => {
		// (10^11 - 10^-8)(10^12 - 10^-6) = 10^23 - 10^5 - 10^4 + 10^-14
		expect(dec(AMOUNT_MAX).mul(dec(RATE_MAX)).toFixed()).toBe(
			"99999999999999999890000.00000000000001",
		);
	});

	it("sums Decimal(19,8) values exactly past 20 significant digits", () => {
		// 11 x (10^11 - 10^-8) = 11 x 10^11 - 11 x 10^-8: 21 significant digits.
		let total = dec(0);
		for (let i = 0; i < 11; i++) total = total.plus(AMOUNT_MAX);
		expect(total.toFixed()).toBe("1099999999999.99999989");
		// The library default of 20 digits loses the last one; the explicit
		// precision is what makes this match a Postgres SUM over numeric.
		const lossy = Dec.clone({ precision: 20 });
		let rounded = new lossy(0);
		for (let i = 0; i < 11; i++) rounded = rounded.plus(AMOUNT_MAX);
		expect(rounded.toFixed()).not.toBe("1099999999999.99999989");
	});

	it("rounds half-even", () => {
		expect(dec("0.5").toDecimalPlaces(0).toFixed()).toBe("0");
		expect(dec("1.5").toDecimalPlaces(0).toFixed()).toBe("2");
		expect(dec("2.5").toDecimalPlaces(0).toFixed()).toBe("2");
		expect(dec("-2.5").toDecimalPlaces(0).toFixed()).toBe("-2");
	});

	it("takes a number, a string or any object that prints a decimal", () => {
		expect(dec(1.25).toFixed()).toBe("1.25");
		expect(dec("1545.123456").toFixed()).toBe("1545.123456");
		expect(
			dec({ toString: () => "0.1" })
				.plus("0.2")
				.toFixed(),
		).toBe("0.3");
	});
});

describe("toFloat, exact", () => {
	it("returns the number a stored decimal reads back as", () => {
		expect(toFloat("12.73333333")).toBe(12.73333333);
		// 15 digits.
		expect(toFloat("123456789012.345")).toBe(123456789012.345);
		// 16 digits that a float still holds: spacing near 1.2e9 is 2.4e-7.
		expect(toFloat("1234567890.123456")).toBe(1234567890.123456);
		expect(toFloat(dec("1450.5"))).toBe(1450.5);
		expect(toFloat(0.30000000000000004)).toBe(0.30000000000000004);
	});

	it("throws rather than lose digits: 16 digits past 2^53, and 19 digits", () => {
		// 2^53 + 1 is the first 16 digit integer a float cannot hold.
		expect(() => toFloat("9007199254740993")).toThrow(RangeError);
		expect(() => toFloat("1234567890123456789")).toThrow(RangeError);
		// Decimal(19,8) at its top: 19 digits.
		expect(() => toFloat("99999999999.99999999")).toThrow(RangeError);
	});

	it("trims a computed figure to the digits asked for", () => {
		expect(toFloat(dec(1).div(3), 15)).toBe(0.333333333333333);
		expect(toFloat("9007199254740993", 15)).toBe(9007199254740990);
	});
});

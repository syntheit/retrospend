import { describe, expect, it } from "vitest";
import {
	addMoney,
	CurrencyMismatchError,
	fromMinor,
	money,
	subtractMoney,
	toMinor,
} from "./money-minor";

const decimal = (text: string) => ({
	toNumber: () => Number(text),
	toString: () => text,
});

describe("money", () => {
	it("upper-cases the code and turns -0 into 0", () => {
		expect(money(-0, " usd ")).toEqual({ minor: 0, currency: "USD" });
		expect(Object.is(money(-0, "USD").minor, 0)).toBe(true);
	});

	it("refuses fractional, unsafe and non-finite minor units", () => {
		expect(() => money(1.5, "USD")).toThrow(RangeError);
		expect(() => money(2 ** 53, "USD")).toThrow(RangeError);
		expect(() => money(Number.NaN, "USD")).toThrow(RangeError);
	});

	it("refuses an empty currency", () => {
		expect(() => money(1, "")).toThrow(RangeError);
	});
});

describe("toMinor", () => {
	it("converts numbers at the currency's minor unit", () => {
		expect(toMinor(12.34, "USD")).toBe(1234);
		expect(toMinor(1200, "JPY")).toBe(1200);
		expect(toMinor(1.25, "KWD")).toBe(1250);
		expect(toMinor(0.004, "ETH")).toBe(400000);
		expect(toMinor(-45, "USD")).toBe(-4500);
	});

	it("trims float noise", () => {
		expect(toMinor(0.1 + 0.2, "USD")).toBe(30);
		expect(toMinor(1.015, "USD")).toBe(102);
	});

	it("rounds a tie half to even on the magnitude, so signs are symmetric", () => {
		expect(toMinor(1.005, "USD")).toBe(100);
		expect(toMinor(-1.005, "USD")).toBe(-100);
		expect(toMinor(1.015, "USD")).toBe(102);
		expect(toMinor(-1.015, "USD")).toBe(-102);
		expect(toMinor(0.125, "USD")).toBe(12);
		expect(toMinor(-0.125, "USD")).toBe(-12);
	});

	it("never returns -0", () => {
		expect(Object.is(toMinor(-0.5, "JPY"), 0)).toBe(true);
		expect(Object.is(toMinor(-0.004, "USD"), 0)).toBe(true);
	});

	it("refuses a number at or above 1e15 minor units, where a float drops digits", () => {
		// 12345678.12345678 BTC as a float reads back as ...680 satoshis.
		expect(() => toMinor(12345678.12345678, "BTC")).toThrow(RangeError);
		expect(() => toMinor(21_000_000, "BTC")).toThrow(RangeError);
		expect(() => toMinor(10_000_000_000_000, "USD")).toThrow(RangeError);
		expect(() => toMinor(-10_000_000_000_000, "USD")).toThrow(RangeError);
		expect(toMinor(9_999_999_999_999.99, "USD")).toBe(999_999_999_999_999);
		// The same amounts as text keep every digit.
		expect(toMinor("12345678.12345678", "BTC")).toBe(1234567812345678);
		expect(toMinor("21000000", "BTC")).toBe(2_100_000_000_000_000);
	});

	it("refuses non-finite numbers", () => {
		expect(() => toMinor(Number.POSITIVE_INFINITY, "USD")).toThrow(RangeError);
		expect(() => toMinor(Number.NaN, "USD")).toThrow(RangeError);
	});

	it("reads decimal strings exactly, beyond float precision", () => {
		expect(toMinor("20999999.12345678", "BTC")).toBe(2099999912345678);
		expect(toMinor("12.34", "USD")).toBe(1234);
		expect(toMinor("-0.05", "USD")).toBe(-5);
		expect(toMinor("12", "USD")).toBe(1200);
		expect(toMinor(".5", "USD")).toBe(50);
		expect(toMinor("12.340000", "USD")).toBe(1234);
		expect(toMinor("-0", "USD")).toBe(0);
	});

	it("reads Prisma Decimals, including exponent notation", () => {
		expect(toMinor(decimal("1234.56"), "USD")).toBe(123456);
		expect(toMinor(decimal("4e-3"), "ETH")).toBe(400000);
		expect(toMinor(decimal("1.5e3"), "JPY")).toBe(1500);
	});

	it("refuses a string more precise than the currency", () => {
		expect(() => toMinor("12.345", "USD")).toThrow(RangeError);
		expect(() => toMinor("1200.5", "JPY")).toThrow(RangeError);
		expect(() => toMinor("1e-9", "BTC")).toThrow(RangeError);
	});

	it("refuses text that is not a decimal and amounts out of range", () => {
		expect(() => toMinor("1,234.56", "USD")).toThrow(RangeError);
		expect(() => toMinor("", "USD")).toThrow(RangeError);
		expect(() => toMinor("abc", "USD")).toThrow(RangeError);
		expect(() => toMinor("100000000000000", "USD")).toThrow(RangeError);
		expect(() => toMinor("1e400", "USD")).toThrow(RangeError);
	});
});

describe("fromMinor", () => {
	it("gives an exact decimal string at full precision", () => {
		expect(fromMinor({ minor: 123456, currency: "USD" })).toBe("1234.56");
		expect(fromMinor({ minor: -5, currency: "USD" })).toBe("-0.05");
		expect(fromMinor({ minor: 1200, currency: "JPY" })).toBe("1200");
		expect(fromMinor({ minor: 400000, currency: "ETH" })).toBe("0.00400000");
		expect(fromMinor({ minor: 1250, currency: "KWD" })).toBe("1.250");
		expect(fromMinor({ minor: 0, currency: "USD" })).toBe("0.00");
	});

	it("round-trips with toMinor", () => {
		for (const [minor, currency] of [
			[2099999912345678, "BTC"],
			[-123456, "ARS"],
			[1, "KWD"],
		] as const) {
			expect(toMinor(fromMinor({ minor, currency }), currency)).toBe(minor);
		}
	});
});

describe("addMoney and subtractMoney", () => {
	const usd = (minor: number) => ({ minor, currency: "USD" });

	it("adds and subtracts in one currency", () => {
		expect(addMoney(usd(1050), usd(250))).toEqual(usd(1300));
		expect(subtractMoney(usd(1050), usd(2000))).toEqual(usd(-950));
	});

	it("treats codes case-insensitively", () => {
		expect(addMoney(usd(1), { minor: 2, currency: "usd" })).toEqual(usd(3));
	});

	it("refuses mixed currencies", () => {
		const ars = { minor: 100, currency: "ARS" };
		expect(() => addMoney(usd(1), ars)).toThrow(CurrencyMismatchError);
		expect(() => subtractMoney(ars, usd(1))).toThrow(
			"Cannot combine ARS and USD amounts",
		);
	});

	it("refuses a result beyond the safe range", () => {
		const max = usd(Number.MAX_SAFE_INTEGER);
		expect(() => addMoney(max, usd(1))).toThrow(RangeError);
	});
});

import { describe, expect, it } from "vitest";
import { Prisma } from "~prisma";
import {
	amountText,
	exactCell,
	minorCell,
	minorOf,
	minorText,
	totalsText,
} from "../amounts";

const D = (text: string) => new Prisma.Decimal(text);

describe("amountText: one half-even rounding at the currency's own digits", () => {
	it.each([
		// 2.675 is a tie at 2 digits: the even neighbor is 2.68. A float reads it
		// as 2.67499999999999982 and toFixed(2) gives "2.67".
		["2.675", "BRL", "2.68"],
		// 2.665 is a tie too: the even neighbor is 2.66.
		["2.665", "BRL", "2.66"],
		["1.005", "USD", "1.00"],
		["1.015", "USD", "1.02"],
		["30", "USD", "30.00"],
		// Seven digits of ARS with cents, no float noise.
		["1234567.89", "ARS", "1234567.89"],
		// A zero-digit currency keeps no fraction.
		["1200", "JPY", "1200"],
		["1200.5", "JPY", "1200"],
		["1201.5", "JPY", "1202"],
		// Crypto keeps its 8 digits and drops trailing zeros: 0.004 ETH is not "0.00".
		["0.004", "ETH", "0.004"],
		["0.00000001", "BTC", "0.00000001"],
		["12.50000000", "ETH", "12.5"],
		["10", "BTC", "10"],
		["-0.005", "USD", "0.00"],
		["-150000.25", "ARS", "-150000.25"],
	])("%s %s is %s", (stored, currency, shown) => {
		expect(amountText(D(stored), currency)).toBe(shown);
	});
});

describe("minor units", () => {
	it("reads a stored amount as an exact integer", () => {
		expect(minorOf(D("1234567.89"), "ARS")).toBe(123456789);
		expect(minorOf(D("0.004"), "ETH")).toBe(400000);
		expect(minorOf(D("-33.33"), "BRL")).toBe(-3333);
	});

	it("writes minor units back with no float step", () => {
		expect(minorText(123456789, "ARS")).toBe("1234567.89");
		expect(minorText(-5, "USD")).toBe("-0.05");
		expect(minorText(400000, "ETH")).toBe("0.004");
		expect(minorText(0, "USD")).toBe("0.00");
	});
});

describe("spreadsheet cells", () => {
	it("keeps a stored decimal exactly as stored, never rounded or in exponent form", () => {
		expect(exactCell(D("12.50000000")).text).toBe("12.5");
		expect(exactCell(D("0.00000001")).text).toBe("0.00000001");
		expect(exactCell(D("-150000.25")).text).toBe("-150000.25");
		// 19 significant digits: more than a float keeps.
		expect(exactCell(D("12345678901.12345678")).text).toBe(
			"12345678901.12345678",
		);
		expect(exactCell(D("1500000")).text).toBe("1500000");
	});

	it("writes a sum without trailing zeros", () => {
		expect(minorCell(4333, "BRL").text).toBe("43.33");
		expect(minorCell(2000, "USD").text).toBe("20");
		expect(minorCell(200000, "ETH").text).toBe("0.002");
		expect(minorCell(-5, "USD").text).toBe("-0.05");
	});
});

describe("totalsText", () => {
	it("adds per currency in minor units and never across currencies", () => {
		const rows = [
			{ amount: D("0.1"), currency: "USD" },
			{ amount: D("0.2"), currency: "USD" },
			{ amount: D("1234567.89"), currency: "ARS" },
			{ amount: D("60000"), currency: "ARS" },
			{ amount: D("0.004"), currency: "ETH" },
		];
		// 0.1 + 0.2 is 0.30000000000000004 as a float; here it is 30 cents.
		expect(totalsText(rows, "ARS")).toEqual([
			"1294567.89 ARS",
			"0.004 ETH",
			"0.30 USD",
		]);
	});

	it("shows zero in the fallback currency for no rows", () => {
		expect(totalsText([], "ARS")).toEqual(["0.00 ARS"]);
	});
});

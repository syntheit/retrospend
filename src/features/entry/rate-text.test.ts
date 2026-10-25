import { describe, expect, it } from "vitest";
import { parseRateText, rateToText, readRateText } from "./rate-text";

describe("parseRateText: a typed rate, not money", () => {
	it("reads four or more decimals that no home currency's minor units allow", () => {
		expect(parseRateText("1.0834", "en-US")).toBe("1.0834");
		expect(parseRateText("0.025", "en-US")).toBe("0.025");
		expect(parseRateText("0.0068", "en-US")).toBe("0.0068");
		expect(parseRateText("0.000000000001", "en-US")).toBe("0.000000000001");
	});

	it("reads the locale's marks: es-AR comma decimals, dot groups", () => {
		expect(parseRateText("1,0834", "es-AR")).toBe("1.0834");
		expect(parseRateText("1.468", "es-AR")).toBe("1468");
		expect(parseRateText("1.475,5", "es-AR")).toBe("1475.5");
		expect(parseRateText("0,0068", "es-AR")).toBe("0.0068");
		// A dot followed by anything but groups of three is the decimal.
		expect(parseRateText("1.0834", "es-AR")).toBe("1.0834");
	});

	it("reads en groups and drops trailing zeros", () => {
		expect(parseRateText("1,468", "en-US")).toBe("1468");
		expect(parseRateText("1,475.50", "en-US")).toBe("1475.5");
		expect(parseRateText("150.25", "en-US")).toBe("150.25");
	});

	it("refuses what is not a rate above zero", () => {
		expect(parseRateText("", "en-US")).toBeNull();
		expect(parseRateText("0", "en-US")).toBeNull();
		expect(parseRateText("0.000", "en-US")).toBeNull();
		expect(parseRateText("abc", "en-US")).toBeNull();
		expect(parseRateText("-1", "en-US")).toBeNull();
		// Rounds to 0 at 12 decimals.
		expect(parseRateText("0.0000000000004", "en-US")).toBeNull();
		expect(parseRateText("1.2.3", "en-US")).toBeNull();
	});

	it("drops trailing zeros before counting decimals", () => {
		expect(parseRateText("1.0834123456780", "en-US")).toBe("1.083412345678");
		expect(parseRateText("1.50000000000000", "en-US")).toBe("1.5");
	});

	it("reads de-CH groups, typographic apostrophe too", () => {
		expect(parseRateText("1’468.5", "de-CH")).toBe("1468.5");
		expect(parseRateText("1'468.5", "de-CH")).toBe("1468.5");
	});

	it("rounds past 12 decimals half-even, by hand", () => {
		// ...678|91234: above half, up.
		expect(parseRateText("1.08341234567891234", "en-US")).toBe(
			"1.083412345679",
		);
		// ...678|4: below half, down.
		expect(parseRateText("1.0834123456784", "en-US")).toBe("1.083412345678");
		// Exactly half: to the even digit.
		expect(parseRateText("1.0000000000025", "en-US")).toBe("1.000000000002");
		expect(parseRateText("1.0000000000035", "en-US")).toBe("1.000000000004");
		// Half with more after it is above half.
		expect(parseRateText("1.00000000000250001", "en-US")).toBe(
			"1.000000000003",
		);
		// The carry runs into the whole part.
		expect(parseRateText("0.9999999999999", "en-US")).toBe("1");
		expect(parseRateText("0.0000000000005", "en-US")).toBeNull();
		expect(parseRateText("0.00000000000051", "en-US")).toBe("0.000000000001");
	});

	it("shows the rounded rate in the field, in the locale's marks", () => {
		expect(readRateText("1,08341234567891234", "es-AR")).toEqual({
			text: "1,083412345679",
			rate: "1.083412345679",
		});
		// Nothing to round: the field keeps what was typed.
		expect(readRateText("1.468", "es-AR")).toEqual({
			text: "1.468",
			rate: "1468",
		});
		expect(readRateText("1.0834123456780", "en-US")).toEqual({
			text: "1.0834123456780",
			rate: "1.083412345678",
		});
		expect(readRateText("abc", "en-US")).toEqual({ text: "abc", rate: null });
	});
});

describe("rateToText: a rate held as a number, as the text the server takes", () => {
	it("writes the digits the number shows, with no exponent and no trailing zeros", () => {
		expect(rateToText(1468.5)).toBe("1468.5");
		expect(rateToText(1.0834)).toBe("1.0834");
		expect(rateToText(150)).toBe("150");
		// String(6.8e-7) is "6.8e-7": the text must be plain digits.
		expect(rateToText(6.8e-7)).toBe("0.00000068");
		expect(rateToText(0.000000000001)).toBe("0.000000000001");
	});

	it("writes the digits the number shows, not its binary expansion", () => {
		// The exact binary values are 25345.669999999998..., 8192.370000000001...
		// and 89500.449999999997...: a text like that is not the rate shown.
		expect(rateToText(25345.67)).toBe("25345.67");
		expect(rateToText(8192.37)).toBe("8192.37");
		expect(rateToText(89500.45)).toBe("89500.45");
		expect(rateToText(67890.12)).toBe("67890.12");
		expect(rateToText(1e-7)).toBe("0.0000001");
		expect(rateToText(1e21)).toBeNull();
	});

	it("keeps the decimals a column keeps: half-even at 6", () => {
		expect(rateToText(1412.5, 6)).toBe("1412.5");
		expect(rateToText(0.1234565, 6)).toBe("0.123456");
		expect(rateToText(0.1234575, 6)).toBe("0.123458");
		expect(rateToText(1e-7, 6)).toBeNull();
	});

	it("rounds past 12 decimals half-even, like a typed rate", () => {
		// 2^-13 is exactly 0.0001220703125: a tie at the 13th decimal, so the
		// even neighbor ...312 is kept, not ...313.
		expect(rateToText(2 ** -13)).toBe("0.000122070312");
		// 2^-12 is exactly 0.000244140625 (12 decimals): kept as is.
		expect(rateToText(2 ** -12)).toBe("0.000244140625");
	});

	it("refuses what is not a rate above zero", () => {
		for (const n of [
			0,
			-1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			1e13,
			1e-13,
		]) {
			expect(rateToText(n), String(n)).toBeNull();
		}
	});
});

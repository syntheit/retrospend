import { describe, expect, it } from "vitest";
import { parseRateText, readRateText } from "./rate-text";

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

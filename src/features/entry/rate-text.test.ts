import { describe, expect, it } from "vitest";
import { parseRateText } from "./rate-text";

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
		expect(parseRateText("0.0000000000001", "en-US")).toBeNull();
		expect(parseRateText("1.2.3", "en-US")).toBeNull();
	});
});

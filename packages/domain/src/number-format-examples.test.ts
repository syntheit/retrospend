import { describe, expect, it } from "vitest";
import { numberFormatExamples } from "./format";

// U+00A0 follows the code, U+202F is the space_comma group mark.
describe("numberFormatExamples", () => {
	it("shows 1,234,567.89 in the user's currency, one line per option", () => {
		expect(numberFormatExamples("USD", "en-US")).toEqual({
			follow: "USD 1,234,567.89",
			comma_dot: "USD 1,234,567.89",
			dot_comma: "USD 1.234.567,89",
			space_comma: "USD 1 234 567,89",
		});
	});

	it("follows the language for the first line", () => {
		const es = numberFormatExamples("ARS", "es-AR");
		expect(es.follow).toBe("ARS 1.234.567,89");
		expect(es.comma_dot).toBe("ARS 1,234,567.89");
	});

	it("uses the currency's own places", () => {
		expect(numberFormatExamples("JPY", "en-US").dot_comma).toBe(
			"JPY 1.234.568",
		);
		expect(numberFormatExamples("KWD", "en-US").comma_dot).toBe(
			"KWD 1,234,567.890",
		);
	});
});

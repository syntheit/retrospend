import { describe, expect, it } from "vitest";
import { numberFormatExamples } from "./format";

// U+00A0 follows a code (and the symbol in es-AR), U+202F is the space_comma group mark.
describe("numberFormatExamples", () => {
	it("shows 1,234,567.89 with the home symbol, one line per option", () => {
		expect(numberFormatExamples("USD", "en-US")).toEqual({
			follow: "$1,234,567.89",
			comma_dot: "$1,234,567.89",
			dot_comma: "$1.234.567,89",
			space_comma: "$1\u202f234\u202f567,89",
		});
	});

	it("follows the language for the first line", () => {
		const es = numberFormatExamples("ARS", "es-AR");
		expect(es.follow).toBe("$\u00a01.234.567,89");
		expect(es.comma_dot).toBe("$\u00a01,234,567.89");
	});

	it("names a currency that has no narrow symbol", () => {
		expect(numberFormatExamples("CHF", "en-US").follow).toBe(
			"CHF\u00a01,234,567.89",
		);
	});

	it("uses the currency's own places", () => {
		expect(numberFormatExamples("JPY", "en-US").dot_comma).toBe(
			"\u00a51.234.568",
		);
		expect(numberFormatExamples("KWD", "en-US").comma_dot).toBe(
			"KWD\u00a01,234,567.890",
		);
	});
});

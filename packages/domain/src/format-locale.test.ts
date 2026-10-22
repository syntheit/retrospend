import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import { decimalSeparator, numberSymbols } from "./format-locale";

describe("numberSymbols locale handling", () => {
	it("reads an underscore tag as a hyphenated one", () => {
		expect(numberSymbols("en_US")).toEqual(numberSymbols("en-US"));
		expect(numberSymbols("es_AR")).toEqual(numberSymbols("es-AR"));
		expect(
			formatMoney({ minor: 123400, currency: "ARS" }, { locale: "es_AR" }),
		).toBe("ARS 1.234");
	});

	it("falls back to en-US for an unknown or malformed locale, not the host default", () => {
		const enUS = numberSymbols("en-US");
		for (const locale of ["zz", "qq-QQ", "not a locale", "", "en-US-x-"]) {
			expect(numberSymbols(locale), locale).toEqual(enUS);
		}
		expect(decimalSeparator("zz")).toBe(".");
	});
});

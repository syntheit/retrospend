import { describe, expect, it } from "vitest";
import { currencyForLocale } from "./currency-country";

const supported = new Set(["USD", "EUR", "ARS", "BRL", "GBP", "MXN", "CHF"]);

describe("currencyForLocale", () => {
	it("reads the region of the locale tag", () => {
		expect(currencyForLocale("es-AR", supported)).toBe("ARS");
		expect(currencyForLocale("pt-BR", supported)).toBe("BRL");
		expect(currencyForLocale("en-GB", supported)).toBe("GBP");
		expect(currencyForLocale("en-US", supported)).toBe("USD");
		expect(currencyForLocale("es_MX", supported)).toBe("MXN");
		expect(currencyForLocale("de-CH", supported)).toBe("CHF");
	});

	it("euro countries get the euro", () => {
		expect(currencyForLocale("de-DE", supported)).toBe("EUR");
		expect(currencyForLocale("fr-FR", supported)).toBe("EUR");
		expect(currencyForLocale("es-ES", supported)).toBe("EUR");
	});

	it("a script subtag is not mistaken for a region", () => {
		expect(currencyForLocale("sr-Latn-AR", supported)).toBe("ARS");
		expect(currencyForLocale("zh-Hant", supported)).toBeNull();
	});

	it("no region or no supported currency gives null", () => {
		expect(currencyForLocale("en", supported)).toBeNull();
		expect(currencyForLocale("es-AR", new Set(["USD"]))).toBeNull();
		expect(currencyForLocale("de-DE", new Set(["USD"]))).toBeNull();
	});
});

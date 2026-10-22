import { describe, expect, it } from "vitest";
import { currencyName } from "./currency-names";

describe("currencyName", () => {
	it("names a currency in the reader's language", () => {
		expect(currencyName("USD", "en")).toBe("US Dollar");
		expect(currencyName("USD", "es-AR").toLowerCase()).toContain("dólar");
		expect(currencyName("EUR", "de")).toBe("Euro");
	});

	it("falls back for codes the runtime does not know", () => {
		expect(currencyName("BTC", "en", "Bitcoin")).toBe("Bitcoin");
		expect(currencyName("XYZQ", "en")).toBe("XYZQ");
	});

	it("an invalid locale still answers", () => {
		expect(currencyName("USD", "not a locale!", "US Dollar")).toBe("US Dollar");
	});
});

import { describe, expect, it } from "vitest";
import { NARROW_SYMBOLS } from "./format";

describe("NARROW_SYMBOLS", () => {
	it("matches CLDR's narrow symbol for every entry", () => {
		for (const [code, symbol] of Object.entries(NARROW_SYMBOLS)) {
			const narrow = new Intl.NumberFormat("en", {
				style: "currency",
				currency: code,
				currencyDisplay: "narrowSymbol",
			})
				.formatToParts(1)
				.find((p) => p.type === "currency")?.value;
			expect(symbol, code).toBe(narrow);
		}
	});
});

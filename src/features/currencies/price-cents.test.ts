import { describe, expect, it } from "vitest";
import { priceCents } from "./price-cents";

describe("priceCents", () => {
	it("whole from 100 units up, cents below", () => {
		expect(priceCents({ minor: 146800, currency: "ARS" })).toBe(false);
		expect(priceCents({ minor: 27685, currency: "ARS" })).toBe(false);
		expect(priceCents({ minor: 9999, currency: "ARS" })).toBe("auto");
		expect(priceCents({ minor: 3520, currency: "ARS" })).toBe("auto");
		// JPY has no minor unit: 100 yen is 100 minor.
		expect(priceCents({ minor: 100, currency: "JPY" })).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import { legacyRateWire } from "./legacy-rate-wire";

describe("legacyRateWire: what the old expense form sends for a rate", () => {
	it("a rate typed by hand goes as its text, and the preview number stays home", () => {
		expect(
			legacyRateWire({
				exchangeRate: 0.000641025641,
				pricingSource: "custom",
				customRate: { base: "EUR", value: "1560.000000000001" },
			}),
		).toEqual({ customRate: { base: "EUR", value: "1560.000000000001" } });
	});

	it("a table rate goes as decimal text, never a float or an exponent", () => {
		expect(
			legacyRateWire({ exchangeRate: 1468.5, pricingSource: "blue" }),
		).toEqual({ exchangeRate: "1468.5" });
		expect(legacyRateWire({ exchangeRate: 6.8e-7 })).toEqual({
			exchangeRate: "0.00000068",
		});
	});

	it("a typed rate left over from a table pick is not sent", () => {
		expect(
			legacyRateWire({
				exchangeRate: 1412,
				pricingSource: "official",
				customRate: { base: "EUR", value: "1500" },
			}),
		).toEqual({ exchangeRate: "1412" });
	});

	it("sends nothing when there is no rate", () => {
		expect(legacyRateWire({})).toEqual({});
		expect(legacyRateWire({ exchangeRate: 0 })).toEqual({});
	});
});

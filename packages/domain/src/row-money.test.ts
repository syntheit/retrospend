/**
 * Home-currency values of a row, exact until the one rounding. Expected values
 * are derived by hand in each comment. Rates are stored units per USD.
 */
import { describe, expect, it } from "vitest";
import { dec } from "./precise-decimal";
import {
	decimalMoney,
	type HomeRates,
	homeDec,
	homeFromUSD,
	homeOf,
} from "./row-money";

const ARS_BLUE: HomeRates = { home: "ARS", homeRate: 1545 };
const JPY: HomeRates = { home: "JPY", homeRate: 17.5 };

describe("homeOf", () => {
	it("ARS blue 1,545: USD 10.01 is 15,465.45 pesos", () => {
		// 10 x 1,545 = 15,450; 0.01 x 1,545 = 15.45.
		expect(homeOf("10.01", "USD", 1, ARS_BLUE)).toEqual({
			minor: 1_546_545,
			currency: "ARS",
		});
	});

	it("JPY home: EUR 1 at 7 a dollar is 2.5 yen, so 2 (half to even); EUR 3 is 7.5, so 8", () => {
		// 1 x 17.5 / 7 = 2.5; 3 x 17.5 / 7 = 7.5. One division, so the tie is exact.
		expect(homeOf("1", "EUR", 7, JPY)?.minor).toBe(2);
		expect(homeOf("3", "EUR", 7, JPY)?.minor).toBe(8);
		expect(homeOf("-1", "EUR", 7, JPY)?.minor).toBe(-2);
	});

	it("an amount already in the home currency needs no rate", () => {
		expect(
			homeOf("12.34", "ARS", null, { home: "ARS", homeRate: null })?.minor,
		).toBe(1_234);
	});

	it("is null without the amount's rate or without the home rate, never 1", () => {
		expect(homeOf("5", "EUR", null, JPY)).toBeNull();
		expect(homeOf("5", "EUR", 0.9, { home: "ARS", homeRate: null })).toBeNull();
		expect(homeOf("5", "USD", 1, { home: "ARS", homeRate: null })).toBeNull();
	});

	it("a refund that rounds to nothing is 0, never -0", () => {
		// -0.004 pesos at the cent.
		const m = homeOf("-0.004", "ARS", null, ARS_BLUE);
		expect(Object.is(m?.minor, 0)).toBe(true);
	});
});

describe("homeFromUSD", () => {
	it("JPY at 150: USD 0.03 is 4.5 yen, so 4; USD 0.01 is 1.5, so 2; refunds mirror", () => {
		const jpy150: HomeRates = { home: "JPY", homeRate: 150 };
		expect(homeFromUSD("0.03", jpy150)?.minor).toBe(4);
		expect(homeFromUSD("0.01", jpy150)?.minor).toBe(2);
		expect(homeFromUSD("-0.03", jpy150)?.minor).toBe(-4);
		expect(homeFromUSD("-0.01", jpy150)?.minor).toBe(-2);
	});

	it("USD home needs no rate; a missing home rate is null", () => {
		expect(homeFromUSD("12.345", { home: "USD", homeRate: null })?.minor).toBe(
			1_234,
		);
		expect(homeFromUSD("1", { home: "ARS", homeRate: null })).toBeNull();
	});
});

describe("homeDec", () => {
	it("keeps the exact value for a sum to round once", () => {
		// 0.07 EUR at 6 a dollar into ARS 1,545: 0.07 x 1,545 / 6 = 18.025.
		expect(homeDec("0.07", "EUR", 6, ARS_BLUE)?.toFixed()).toBe("18.025");
		expect(decimalMoney(dec("18.025"), "ARS").minor).toBe(1_802);
	});
});

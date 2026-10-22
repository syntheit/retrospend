import { describe, expect, it } from "vitest";
import { computeHomeCurrencyTotal } from "../balance-utils";

describe("computeHomeCurrencyTotal", () => {
	it("converts through USD with the stored rate convention", () => {
		const rates = new Map([
			["ARS", 1500],
			["EUR", 0.9],
		]);
		const total = computeHomeCurrencyTotal(
			[{ balance: 3000, currency: "ARS", direction: "they_owe_you" }],
			"EUR",
			rates,
		);
		expect(total).toEqual({ amount: 1.8, canConvert: true });
	});

	it("flags a missing rate instead of counting the balance as 0", () => {
		const rates = new Map([["EUR", 0.9]]);
		const total = computeHomeCurrencyTotal(
			[
				{ balance: 10, currency: "EUR", direction: "they_owe_you" },
				{ balance: 3000, currency: "ARS", direction: "you_owe_them" },
			],
			"EUR",
			rates,
		);
		expect(total).toEqual({ amount: 10, canConvert: false });
	});

	it("flags a missing home currency rate", () => {
		const rates = new Map([["ARS", 1500]]);
		const total = computeHomeCurrencyTotal(
			[{ balance: 3000, currency: "ARS", direction: "they_owe_you" }],
			"EUR",
			rates,
		);
		expect(total).toBeNull();
	});

	it("treats a zero rate as missing", () => {
		const rates = new Map([["ARS", 0]]);
		const total = computeHomeCurrencyTotal(
			[
				{ balance: 5, currency: "USD", direction: "they_owe_you" },
				{ balance: 3000, currency: "ARS", direction: "they_owe_you" },
			],
			"USD",
			rates,
		);
		expect(total).toEqual({ amount: 5, canConvert: false });
	});
});

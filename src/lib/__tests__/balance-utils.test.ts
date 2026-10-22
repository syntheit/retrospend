import { describe, expect, it } from "vitest";
import {
	computeHomeCurrencyTotal,
	formatSettleLabel,
	isBalanceSettled,
} from "../balance-utils";

const fmt = (amount: number, currency: string) =>
	`${currency} ${amount.toFixed(2)}`;

describe("isBalanceSettled", () => {
	it("is settled when every balance is zero", () => {
		expect(isBalanceSettled([], null)).toBe(true);
		expect(
			isBalanceSettled(
				[{ balance: 0, currency: "EUR", direction: "settled" }],
				null,
			),
		).toBe(true);
	});

	it("is not settled when the debt could not be converted", () => {
		// No EUR rate: the total comes back null.
		const balances = [
			{ balance: 40, currency: "EUR", direction: "you_owe_them" },
		];
		const total = computeHomeCurrencyTotal(balances, "USD", new Map());
		expect(total).toBeNull();
		expect(isBalanceSettled(balances, total)).toBe(false);
	});

	it("is not settled when only part of the debt converted", () => {
		const balances = [
			{ balance: 10, currency: "USD", direction: "they_owe_you" },
			{ balance: 10, currency: "XYZ", direction: "you_owe_them" },
		];
		const total = computeHomeCurrencyTotal(balances, "USD", new Map());
		expect(total).toEqual({ amount: 10, canConvert: false });
		expect(isBalanceSettled(balances, total)).toBe(false);
	});

	it("is settled when converted balances cancel out", () => {
		const balances = [
			{ balance: 10, currency: "USD", direction: "they_owe_you" },
			{ balance: 10, currency: "USD", direction: "you_owe_them" },
		];
		expect(isBalanceSettled(balances, { amount: 0, canConvert: true })).toBe(
			true,
		);
	});
});

describe("formatSettleLabel", () => {
	it("uses the converted home total", () => {
		expect(
			formatSettleLabel(
				"you_owe_them",
				{ amount: -20, canConvert: true },
				"USD",
				[{ balance: 20, currency: "USD", direction: "you_owe_them" }],
				fmt,
			),
		).toBe("Pay USD 20.00");
	});

	it("takes the verb from the sign of the converted total", () => {
		expect(
			formatSettleLabel(
				"they_owe_you",
				{ amount: -5, canConvert: true },
				"USD",
				[
					{ balance: 10, currency: "EUR", direction: "they_owe_you" },
					{ balance: 16, currency: "USD", direction: "you_owe_them" },
				],
				fmt,
			),
		).toBe("Pay USD 5.00");
	});

	it("falls back to a balance in the same direction as the verb", () => {
		expect(
			formatSettleLabel(
				"you_owe_them",
				null,
				"USD",
				[
					{ balance: 30, currency: "EUR", direction: "they_owe_you" },
					{ balance: 12, currency: "GBP", direction: "you_owe_them" },
				],
				fmt,
			),
		).toBe("Pay GBP 12.00");
	});

	it("keeps verb and amount together when no balance matches the direction", () => {
		expect(
			formatSettleLabel(
				"you_owe_them",
				null,
				"USD",
				[{ balance: 30, currency: "EUR", direction: "they_owe_you" }],
				fmt,
			),
		).toBe("Request EUR 30.00");
	});

	it("uses the given labels", () => {
		expect(
			formatSettleLabel(
				"they_owe_you",
				{ amount: 8, canConvert: true },
				"USD",
				[{ balance: 8, currency: "USD", direction: "they_owe_you" }],
				fmt,
				{ pay: (a) => `pay ${a}`, request: (a) => `ask ${a}` },
			),
		).toBe("ask USD 8.00");
	});
});

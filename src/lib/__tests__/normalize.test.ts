import { describe, expect, it } from "vitest";
import {
	normalizeExpense,
	normalizeExpensesFromApi,
	normalizeAsset,
	getExpenseDisplayRate,
	convertExpenseAmountForDisplay,
	type NormalizedExpense,
	type RawAsset,
} from "../normalize";

const makeExpense = (overrides: Partial<NormalizedExpense> = {}): NormalizedExpense => ({
	id: "exp-1",
	title: "Coffee",
	amount: 4.5,
	currency: "USD",
	exchangeRate: 1,
	amountInUSD: 4.5,
	date: new Date(2024, 2, 15),
	location: null,
	description: null,
	categoryId: null,
	category: null,
	...overrides,
});

describe("normalizeExpense", () => {
	it("converts Prisma Decimal-like amount to number", () => {
		const raw = {
			id: "1",
			amount: { toNumber: () => 42.5, toString: () => "42.5" },
			currency: "USD",
			date: "2024-03-15",
		};
		const result = normalizeExpense(raw as Parameters<typeof normalizeExpense>[0]);
		expect(result.amount).toBe(42.5);
	});

	it("converts string date to Date object", () => {
		const raw = { id: "1", date: "2024-03-15", currency: "USD" };
		const result = normalizeExpense(raw);
		expect(result.date).toBeInstanceOf(Date);
	});

	it("keeps Date object as-is", () => {
		const d = new Date(2024, 2, 15);
		const raw = { id: "1", date: d, currency: "USD" };
		const result = normalizeExpense(raw);
		expect(result.date).toBe(d);
	});

	it("handles null title", () => {
		const raw = { id: "1", date: "2024-03-15", title: null };
		const result = normalizeExpense(raw);
		expect(result.title).toBeNull();
	});

	it("handles undefined title as null", () => {
		const raw = { id: "1", date: "2024-03-15" };
		const result = normalizeExpense(raw);
		expect(result.title).toBeNull();
	});

	it("converts exchangeRate from string-like to number", () => {
		const raw = { id: "1", date: "2024-03-15", exchangeRate: "1.08" };
		const result = normalizeExpense(raw as Parameters<typeof normalizeExpense>[0]);
		expect(result.exchangeRate).toBe(1.08);
	});

	it("sets exchangeRate to null when missing", () => {
		const raw = { id: "1", date: "2024-03-15" };
		const result = normalizeExpense(raw);
		expect(result.exchangeRate).toBeNull();
	});

	it("sets amountInUSD to null when null", () => {
		const raw = { id: "1", date: "2024-03-15", amountInUSD: null };
		const result = normalizeExpense(raw);
		expect(result.amountInUSD).toBeNull();
	});

	it("defaults currency to USD when missing", () => {
		const raw = { id: "1", date: "2024-03-15" };
		const result = normalizeExpense(raw);
		expect(result.currency).toBe("USD");
	});

	it("maps category when present", () => {
		const raw = {
			id: "1",
			date: "2024-03-15",
			category: { id: "cat-1", name: "Food", color: "#ff0000" },
		};
		const result = normalizeExpense(raw);
		expect(result.category).toEqual({ id: "cat-1", name: "Food", color: "#ff0000", icon: undefined });
	});

	it("sets category to null when missing", () => {
		const raw = { id: "1", date: "2024-03-15" };
		const result = normalizeExpense(raw);
		expect(result.category).toBeNull();
	});

	it("falls back to category.id for categoryId when categoryId missing", () => {
		const raw = {
			id: "1",
			date: "2024-03-15",
			category: { id: "cat-1", name: "Food", color: "#ff0000" },
		};
		const result = normalizeExpense(raw);
		expect(result.categoryId).toBe("cat-1");
	});
});

describe("normalizeExpensesFromApi", () => {
	it("normalizes valid input array", () => {
		const input = [{ id: "1", date: "2024-03-15", currency: "USD" }];
		const result = normalizeExpensesFromApi(input);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("1");
	});

	it("throws on Zod validation failure (missing id)", () => {
		const input = [{ date: "2024-03-15" }]; // missing id
		expect(() => normalizeExpensesFromApi(input)).toThrow();
	});

	it("handles empty array", () => {
		const result = normalizeExpensesFromApi([]);
		expect(result).toHaveLength(0);
	});
});

describe("normalizeAsset", () => {
	const makeRaw = (overrides: Partial<RawAsset> = {}): RawAsset => ({
		id: "asset-1",
		name: "Savings",
		type: "SAVINGS" as RawAsset["type"],
		currency: "USD",
		balance: 10000,
		balanceInUSD: 10000,
		exchangeRate: null,
		isLiquid: true,
		...overrides,
	});

	it("converts exchangeRate from string to number", () => {
		const asset = normalizeAsset(makeRaw({ exchangeRate: "1.08" }));
		expect(asset.exchangeRate).toBe(1.08);
	});

	it("converts exchangeRate from number to number", () => {
		const asset = normalizeAsset(makeRaw({ exchangeRate: 1.08 }));
		expect(asset.exchangeRate).toBe(1.08);
	});

	it("converts exchangeRate null to undefined", () => {
		const asset = normalizeAsset(makeRaw({ exchangeRate: null }));
		expect(asset.exchangeRate).toBeUndefined();
	});

	it("uses balanceInTargetCurrency when present", () => {
		const asset = normalizeAsset(makeRaw({ balanceInTargetCurrency: 9000 }));
		expect(asset.balanceInTargetCurrency).toBe(9000);
	});

	it("falls back to balanceInUSD when balanceInTargetCurrency missing", () => {
		const asset = normalizeAsset(makeRaw({ balanceInUSD: 10000 }));
		expect(asset.balanceInTargetCurrency).toBe(10000);
	});
});

describe("getExpenseDisplayRate", () => {
	it("returns expense.exchangeRate when target matches expense currency", () => {
		const expense = makeExpense({ currency: "EUR", exchangeRate: 1.08 });
		const rate = getExpenseDisplayRate(expense, "EUR", 1.09);
		expect(rate).toBe(1.08);
	});

	it("returns liveRateToTarget when currencies differ", () => {
		const expense = makeExpense({ currency: "USD", exchangeRate: 1 });
		const rate = getExpenseDisplayRate(expense, "EUR", 1.09);
		expect(rate).toBe(1.09);
	});

	it("returns liveRateToTarget when expense.exchangeRate is falsy (null)", () => {
		const expense = makeExpense({ currency: "EUR", exchangeRate: null });
		const rate = getExpenseDisplayRate(expense, "EUR", 1.09);
		expect(rate).toBe(1.09);
	});

	it("returns null liveRateToTarget when no rate available", () => {
		const expense = makeExpense({ currency: "GBP", exchangeRate: null });
		const rate = getExpenseDisplayRate(expense, "EUR", null);
		expect(rate).toBeNull();
	});
});

describe("convertExpenseAmountForDisplay", () => {
	it("returns original amount when no amountInUSD", () => {
		const expense = makeExpense({ amountInUSD: null, amount: 42 });
		const result = convertExpenseAmountForDisplay(expense, "EUR", 1.09);
		expect(result).toBe(42);
	});

	it("returns expense.amount when target matches expense currency", () => {
		const expense = makeExpense({ currency: "EUR", amount: 20, amountInUSD: 21.6 });
		const result = convertExpenseAmountForDisplay(expense, "EUR", 0.92);
		expect(result).toBe(20);
	});

	it("returns amountInUSD as fallback when no rate available", () => {
		const expense = makeExpense({
			currency: "ARS",
			amount: 5000,
			amountInUSD: 3.53,
			exchangeRate: null,
		});
		const result = convertExpenseAmountForDisplay(expense, "EUR", null);
		expect(result).toBe(3.53);
	});

	it("converts fiat: amountInUSD * rate", () => {
		const expense = makeExpense({ currency: "USD", amount: 10, amountInUSD: 10 });
		// EUR is fiat, rate = 0.92 (units per USD)
		const result = convertExpenseAmountForDisplay(expense, "EUR", 0.92);
		expect(result).toBeCloseTo(9.2);
	});

	it("converts crypto: amountInUSD / rate", () => {
		const expense = makeExpense({ currency: "USD", amount: 50000, amountInUSD: 50000 });
		// BTC is crypto, rate = 50000 (USD per BTC)
		const result = convertExpenseAmountForDisplay(expense, "BTC", 50000);
		expect(result).toBeCloseTo(1);
	});
});

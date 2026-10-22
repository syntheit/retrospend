import { describe, expect, it } from "vitest";
import { expenseLoadKey, expenseToFormValues } from "~/hooks/use-expense-form";

const saved = {
	id: "exp_1",
	updatedAt: new Date("2026-10-01T12:00:00Z"),
	title: "Lunch",
	amount: 12.5,
	currency: "ARS",
	exchangeRate: 1200,
	amountInUSD: 0.01,
	date: new Date("2026-10-01T15:00:00Z"),
	location: null,
	description: null,
	categoryId: "cat_1",
	isAmortizedParent: false,
	children: [],
	excludeFromAnalytics: false,
};

describe("expense load key", () => {
	it("is null before the expense loads", () => {
		expect(expenseLoadKey(undefined)).toBeNull();
		expect(expenseLoadKey(null)).toBeNull();
	});

	it("stays the same for a fresh copy of the same saved expense", () => {
		// A refetch or a parent re-render can hand the hook a new object with the
		// same data. That must not reset the form while the user is typing.
		const copy = { ...saved, updatedAt: new Date(saved.updatedAt) };
		expect(expenseLoadKey(copy)).toBe(expenseLoadKey(saved));
	});

	it("changes when the expense is saved again or a different one loads", () => {
		const resaved = { ...saved, updatedAt: new Date("2026-10-01T12:05:00Z") };
		expect(expenseLoadKey(resaved)).not.toBe(expenseLoadKey(saved));
		expect(expenseLoadKey({ ...saved, id: "exp_2" })).not.toBe(
			expenseLoadKey(saved),
		);
	});

	it("treats a serialized updatedAt like the Date it came from", () => {
		expect(
			expenseLoadKey({ ...saved, updatedAt: saved.updatedAt.toISOString() }),
		).toBe(expenseLoadKey(saved));
	});
});

describe("expense form values", () => {
	it("maps a saved expense to the form fields", () => {
		expect(expenseToFormValues(saved)).toEqual({
			title: "Lunch",
			amount: 12.5,
			currency: "ARS",
			exchangeRate: 1200,
			amountInUSD: 0.01,
			date: new Date("2026-10-01T15:00:00Z"),
			location: "",
			description: "",
			categoryId: "cat_1",
			spreadOverTime: false,
			amortizeOver: 3,
			excludeFromAnalytics: false,
		});
	});

	it("keeps the amortization length of a spread expense", () => {
		const values = expenseToFormValues({
			...saved,
			isAmortizedParent: true,
			children: [{}, {}, {}, {}, {}, {}],
		});
		expect(values.spreadOverTime).toBe(true);
		expect(values.amortizeOver).toBe(6);
	});
});

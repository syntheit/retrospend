import { describe, expect, it } from "vitest";
import {
	BudgetImportSchema,
	ExpenseImportSchema,
	WealthImportSchema,
} from "../schemas/data-importer";

const base = { title: "Rent", amount: "1000", currency: "usd", date: "2026-10-01" };

describe("ExpenseImportSchema excludeFromAnalytics", () => {
	it("reads the exported column", () => {
		expect(
			ExpenseImportSchema.parse({ ...base, excludeFromAnalytics: "true" })
				.excludeFromAnalytics,
		).toBe(true);
		expect(
			ExpenseImportSchema.parse({ ...base, excludeFromAnalytics: "false" })
				.excludeFromAnalytics,
		).toBe(false);
	});

	it("leaves it unset when the column is missing or empty", () => {
		expect(ExpenseImportSchema.parse(base).excludeFromAnalytics).toBeUndefined();
		expect(
			ExpenseImportSchema.parse({ ...base, excludeFromAnalytics: "" })
				.excludeFromAnalytics,
		).toBeUndefined();
	});
});

describe("import row error messages", () => {
	function errors(input: unknown) {
		const result = ExpenseImportSchema.safeParse(input);
		if (result.success) return [];
		return result.error.issues.map(
			(issue) => `${String(issue.path[0])}: ${issue.message}`,
		);
	}

	it("reports missing columns as Required", () => {
		expect(errors({})).toEqual([
			"title: Required",
			"amount: Required",
			"currency: Required",
			"date: Required",
		]);
	});

	it("reports blank or unreadable cells with the same messages as before", () => {
		expect(errors({ title: "", amount: "", currency: "", date: "" })).toEqual([
			"title: Title is required",
			"amount: Required",
			"currency: Currency must be a 3-letter code",
			"date: Required",
		]);
		expect(errors({ ...base, amount: "-5", date: "10/01/2026" })).toEqual([
			"amount: Amount must be positive",
			"date: Required",
		]);
	});

	it("cleans currency formatting and upper-cases the code", () => {
		const row = ExpenseImportSchema.parse({
			...base,
			amount: "$1,200.50",
			amountInUSD: "1,300",
		});
		expect(row.amount).toBe(1200.5);
		expect(row.amountInUSD).toBe(1300);
		expect(row.currency).toBe("USD");
		expect(row.date).toEqual(new Date(2026, 9, 1));
	});
});

describe("budget and wealth import defaults", () => {
	it("fills the optional flags when the columns are missing", () => {
		expect(BudgetImportSchema.parse({ amount: "100", period: "2026-10-01" })).toEqual({
			amount: 100,
			period: new Date(2026, 9, 1),
			isRollover: false,
			rolloverAmount: 0,
			pegToActual: false,
		});
		expect(
			WealthImportSchema.parse({
				name: "Bank",
				balance: "10",
				currency: "usd",
				type: "cash",
			}),
		).toEqual({
			name: "Bank",
			balance: 10,
			currency: "USD",
			type: "CASH",
			isLiquid: false,
		});
	});

	it("reads yes, true and 1 as true", () => {
		const row = BudgetImportSchema.parse({
			amount: "100",
			period: "2026-10-01",
			isRollover: "Yes",
			pegToActual: "1",
		});
		expect(row.isRollover).toBe(true);
		expect(row.pegToActual).toBe(true);
	});
});

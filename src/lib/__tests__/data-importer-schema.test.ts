import { describe, expect, it } from "vitest";
import { ExpenseImportSchema } from "../schemas/data-importer";

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

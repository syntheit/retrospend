import { describe, expect, it } from "vitest";
import { expenseCategory } from "./category";
import { CATEGORY_NOT_FOUND, CategoryNotFoundError } from "./refusals";

const food = { id: "c1", kind: "EXPENSE", excludeByDefault: false };

describe("expenseCategory", () => {
	it("passes an expense category through unchanged", () => {
		expect(expenseCategory(food, "not_found")).toBe(food);
	});

	it("income category throws CategoryNotFoundError", () => {
		const income = { id: "c2", kind: "INCOME", excludeByDefault: false };
		expect(() => expenseCategory(income, "not_found")).toThrow(
			CategoryNotFoundError,
		);
		expect(() => expenseCategory(income, "not_found")).toThrow(
			CATEGORY_NOT_FOUND,
		);
	});

	it("a category the lookup did not find (not the person's, or gone) throws", () => {
		expect(() => expenseCategory(null, "not_found")).toThrow(
			CategoryNotFoundError,
		);
		expect(() => expenseCategory(undefined, "not_found")).toThrow(
			CategoryNotFoundError,
		);
	});

	it("carries the call site's v1 code, one message for both", () => {
		const code = (c: "not_found" | "forbidden") => {
			try {
				expenseCategory(null, c);
			} catch (e) {
				return e instanceof CategoryNotFoundError
					? [e.v1Code, e.message]
					: null;
			}
			return null;
		};
		expect(code("not_found")).toEqual(["not_found", "Category not found"]);
		expect(code("forbidden")).toEqual(["forbidden", "Category not found"]);
	});
});

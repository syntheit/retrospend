import { describe, expect, it } from "vitest";
import {
	trimmedCategoryName,
	isBlankCategoryName,
	sameCategoryName,
} from "./category-name";

describe("the category name rule", () => {
	it("keeps case: Food and food are two names", () => {
		expect(sameCategoryName("Food", "food")).toBe(false);
		expect(sameCategoryName("Food", "FOOD")).toBe(false);
	});

	it("ignores spaces at either end: Food and 'Food ' are one name", () => {
		expect(sameCategoryName("Food", "Food ")).toBe(true);
		expect(sameCategoryName("  Food", "Food  ")).toBe(true);
		expect(trimmedCategoryName("  Food ")).toBe("Food");
	});

	it("keeps spaces inside a name", () => {
		expect(sameCategoryName("Eating out", "Eatingout")).toBe(false);
		expect(sameCategoryName("Eating out", "Eating  out")).toBe(false);
	});

	it("calls a name of only spaces blank, and no other", () => {
		expect(isBlankCategoryName("   ")).toBe(true);
		expect(isBlankCategoryName("")).toBe(true);
		expect(isBlankCategoryName(" a ")).toBe(false);
	});
});

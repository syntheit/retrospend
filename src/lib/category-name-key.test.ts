import { describe, expect, it } from "vitest";
import { categoryNameKey } from "./category-name-key";

describe("categoryNameKey", () => {
	it("ignores surrounding spaces and case, nothing else", () => {
		expect(categoryNameKey("Food ")).toBe(categoryNameKey("food"));
		expect(categoryNameKey("  Food\t")).toBe("food");
		expect(categoryNameKey("Eating out")).not.toBe(
			categoryNameKey("Eatingout"),
		);
	});
});

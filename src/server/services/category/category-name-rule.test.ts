/**
 * The category name rule has one owner (packages/domain/src/category-name.ts).
 * The contract cannot import the domain, so its own "blank once trimmed" check
 * is a copy; this test compares them on the same names so they cannot drift.
 */
import { categoryNameSchema } from "@retrospend/api-contract";
import {
	isBlankCategoryName,
	sameCategoryName,
} from "@retrospend/domain/category-name";
import { describe, expect, it } from "vitest";

const NAMES = [
	"Food",
	"Food ",
	" Food",
	"food",
	"",
	" ",
	"   ",
	" ",
	"　",
	"a b",
	"\t",
];

describe("the category name rule", () => {
	it("is the contract's: a name the domain calls blank is refused, any other is taken as typed", () => {
		for (const name of NAMES) {
			const parsed = categoryNameSchema.safeParse(name);
			// A tab is a control character: the contract's userText refuses it
			// before the blank check, and the domain would call it blank too.
			expect(parsed.success, JSON.stringify(name)).toBe(
				!isBlankCategoryName(name),
			);
			if (parsed.success) expect(parsed.data).toBe(name);
		}
	});

	it("tells the names apart the way the server's compare does", () => {
		expect(sameCategoryName("Food", "Food ")).toBe(true);
		expect(sameCategoryName("Food", "food")).toBe(false);
	});
});

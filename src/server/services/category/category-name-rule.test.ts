/**
 * The category name rule has one owner (packages/domain/src/category-name.ts).
 * The server's name index imports it, and a test below fails if the index
 * stops agreeing with it. The contract (api-contract has no dependency on the
 * domain, and adding one is the owner's call) keeps its own "blank once
 * trimmed" check; the test compares it with the owner on the same names so the
 * two cannot drift.
 */
import { randomBytes } from "node:crypto";
import { computeCategoryNameIndex } from "~/server/services/category-name-index.service";
import { Keyring } from "~/server/crypto/field-crypto";
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

	it("is the name index's: two names share an index exactly when the domain says they are one name", () => {
		const ring = new Keyring([{ id: 1, key: randomBytes(32) }]);
		for (const a of NAMES)
			for (const b of NAMES)
				expect(
					computeCategoryNameIndex(ring, a) ===
						computeCategoryNameIndex(ring, b),
					`${JSON.stringify(a)} ${JSON.stringify(b)}`,
				).toBe(sameCategoryName(a, b));
	});

	it("tells the names apart the way the server's compare does", () => {
		expect(sameCategoryName("Food", "Food ")).toBe(true);
		expect(sameCategoryName("Food", "food")).toBe(false);
	});
});

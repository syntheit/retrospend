import { describe, expect, it } from "vitest";
import { categoryIconName } from "./category-icons";

describe("categoryIconName", () => {
	it("uses the stored key when it is a known glyph", () => {
		expect(categoryIconName("Whatever", "Plane")).toBe("Plane");
	});

	it("falls back to the name's usual glyph for no key or an unknown one", () => {
		expect(categoryIconName("Coffee shops", null)).toBe("Coffee");
		expect(categoryIconName("Groceries", "NotAnIcon")).toBe("ShoppingBasket");
	});

	it("ends in the tag glyph when nothing fits", () => {
		expect(categoryIconName("Zzz", undefined)).toBe("Tag");
	});
});

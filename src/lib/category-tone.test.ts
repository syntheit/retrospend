import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS } from "~/lib/constants";
import { CATEGORY_TONE, categoryTone } from "./category-tone";

describe("categoryTone", () => {
	it("gives every stored color its own token, 1 to 21", () => {
		const tones = CATEGORY_COLORS.map((c) => CATEGORY_TONE[c]);
		expect(new Set(tones).size).toBe(CATEGORY_COLORS.length);
		expect(Math.min(...tones)).toBe(1);
		expect(Math.max(...tones)).toBe(21);
	});

	it("keeps hues close: emerald is green, red is red, blue is blue", () => {
		expect(categoryTone("emerald")).toBe(1); // hue 162
		expect(categoryTone("red")).toBe(21); // hue 25
		expect(categoryTone("blue")).toBe(7); // hue 265
	});

	it("falls back to the first token for an unknown name", () => {
		expect(categoryTone("chartreuse")).toBe(1);
	});
});

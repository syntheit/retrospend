import { describe, expect, it } from "vitest";
import { CATEGORY_TONE, categoryTone, NO_CATEGORY_TONE } from "./category-tone";

describe("categoryTone", () => {
	it("gives every stored color its own token, 1 to 21", () => {
		const tones = Object.values(CATEGORY_TONE);
		expect(tones).toHaveLength(21);
		expect(new Set(tones).size).toBe(21);
		expect(Math.min(...tones)).toBe(1);
		expect(Math.max(...tones)).toBe(21);
	});

	it("keeps hues close: emerald is green, red is red, blue is blue", () => {
		expect(categoryTone("emerald")).toBe(1); // hue 162
		expect(categoryTone("blue")).toBe(7); // hue 265
		expect(categoryTone("red")).toBe(21); // hue 25
	});

	it("falls back to the neutral slot for an unknown name", () => {
		expect(categoryTone("chartreuse")).toBe(NO_CATEGORY_TONE);
	});
});

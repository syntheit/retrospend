import { describe, expect, it } from "vitest";
import { groupSpentBasis } from "./month-view";

describe("groupSpentBasis", () => {
	it("is the spent share of what the group holds, in hundredths of a percent", () => {
		expect(groupSpentBasis(10_000, 2_500)).toBe(2_500);
		expect(groupSpentBasis(10_000, 3_333)).toBe(3_333);
	});

	it("caps at the whole bar and floors at nothing spent", () => {
		expect(groupSpentBasis(10_000, 15_000)).toBe(10_000);
		expect(groupSpentBasis(10_000, 0)).toBe(0);
		expect(groupSpentBasis(10_000, -500)).toBe(0);
	});

	it("is null when the group holds nothing", () => {
		expect(groupSpentBasis(0, 500)).toBeNull();
		expect(groupSpentBasis(-100, 500)).toBeNull();
	});
});

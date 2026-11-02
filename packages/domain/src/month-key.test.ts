import { describe, expect, it } from "vitest";
import { addMonths, monthKey, monthParts } from "./month-key";

describe("month keys", () => {
	it("splits and joins a key", () => {
		expect(monthKey(2026, 10)).toBe(202610);
		expect(monthParts(202610)).toEqual({ year: 2026, month: 10 });
	});

	it("steps across year ends in both directions", () => {
		expect(addMonths(202612, 1)).toBe(202701);
		expect(addMonths(202601, -1)).toBe(202512);
		expect(addMonths(202610, 0)).toBe(202610);
		expect(addMonths(202610, -13)).toBe(202509);
	});

	it("refuses a key that is not a month", () => {
		expect(() => monthParts(202613)).toThrow(RangeError);
		expect(() => addMonths(202600, 1)).toThrow(RangeError);
	});
});

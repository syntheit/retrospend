import { describe, expect, it } from "vitest";
import { crossFractionDec, crossRateDec } from "./money-dec";
import { roundedMinor } from "./money-minor";
import { dec } from "./precise-decimal";

describe("crossFractionDec", () => {
	it("keeps NOK at 9 into JPY at 16.5 undivided: 3 x 16.5 / 9 is the tie 5.5", () => {
		const [num, den] = crossFractionDec("NOK", 9, "JPY", 16.5);
		expect([num.toFixed(), den.toFixed()]).toEqual(["16.5", "9"]);
		// One division: 3 x 16.5 = 49.5, / 9 = 5.5, half even gives 6 (5 is odd).
		expect(dec(3).mul(num).div(den).toFixed()).toBe("5.5");
		expect(roundedMinor(dec(3).mul(num).div(den), "JPY")).toBe(6);
		// The same pair is the shown rate once divided.
		expect(crossRateDec("NOK", 9, "JPY", 16.5).toFixed(6)).toBe("1.833333");
	});
});

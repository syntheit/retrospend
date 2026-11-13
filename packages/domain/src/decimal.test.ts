import { describe, expect, it } from "vitest";
import { isPrismaDecimal } from "./decimal";
import { dec } from "./precise-decimal";

describe("isPrismaDecimal", () => {
	it("recognizes an object with toNumber and toString", () => {
		expect(
			isPrismaDecimal({ toNumber: () => 1.5, toString: () => "1.5" }),
		).toBe(true);
		expect(isPrismaDecimal(dec("1.5"))).toBe(true);
	});

	it("refuses numbers, text, null and plain objects", () => {
		expect(isPrismaDecimal(1.5)).toBe(false);
		expect(isPrismaDecimal("1.5")).toBe(false);
		expect(isPrismaDecimal(null)).toBe(false);
		expect(isPrismaDecimal({ amount: 1 })).toBe(false);
	});
});

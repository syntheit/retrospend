import { describe, expect, it } from "vitest";
import { toNumber, toNumberOrNull, toNumberWithDefault } from "../decimal";

describe("Decimal utilities", () => {
	describe("toNumber", () => {
		it("converts a standard number to a number", () => {
			expect(toNumber(123.45)).toBe(123.45);
		});

		it("converts a string representation of a number to a number", () => {
			expect(toNumber("123.45")).toBe(123.45);
		});

		it("returns undefined for null", () => {
			expect(toNumber(null)).toBeUndefined();
		});

		it("returns undefined for undefined", () => {
			expect(toNumber(undefined)).toBeUndefined();
		});

		it("returns undefined for non-numeric strings", () => {
			expect(toNumber("abc")).toBeUndefined();
		});

		it("converts a mocked Prisma Decimal object to a number", () => {
			const mockDecimal = {
				toNumber: () => 123.45,
				toString: () => "123.45",
			};
			expect(toNumber(mockDecimal)).toBe(123.45);
		});
	});

	describe("toNumberWithDefault", () => {
		it("returns the number for valid inputs", () => {
			expect(toNumberWithDefault(123.45)).toBe(123.45);
		});

		it("returns 0 for null", () => {
			expect(toNumberWithDefault(null)).toBe(0);
		});

		it("returns 0 for undefined", () => {
			expect(toNumberWithDefault(undefined)).toBe(0);
		});

		it("returns 0 for non-numeric input", () => {
			expect(toNumberWithDefault("abc")).toBe(0);
		});
	});

	describe("toNumberOrNull", () => {
		it("returns the number for valid inputs", () => {
			expect(toNumberOrNull(123.45)).toBe(123.45);
		});

		it("returns null for null", () => {
			expect(toNumberOrNull(null)).toBeNull();
		});

		it("returns null for undefined", () => {
			expect(toNumberOrNull(undefined)).toBeNull();
		});

		it("returns null for non-numeric input", () => {
			expect(toNumberOrNull("abc")).toBeNull();
		});
	});
});

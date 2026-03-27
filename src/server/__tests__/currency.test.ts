import { describe, expect, it } from "vitest";
import { toUSD, fromUSD } from "../currency";

describe("toUSD", () => {
	describe("USD passthrough", () => {
		it("returns amount unchanged for USD", () => {
			expect(toUSD(100, "USD", 1)).toBe(100);
		});

		it("USD passthrough ignores rate", () => {
			expect(toUSD(50, "USD", 0)).toBe(50);
		});
	});

	describe("fiat to USD (amount / rate)", () => {
		it("converts ARS to USD: 5000 / 1415 ≈ 3.53", () => {
			expect(toUSD(5000, "ARS", 1415)).toBeCloseTo(3.534, 3);
		});

		it("converts EUR to USD: 100 / 0.92 ≈ 108.70", () => {
			expect(toUSD(100, "EUR", 0.92)).toBeCloseTo(108.7, 1);
		});

		it("converts GBP to USD: 50 / 0.79 ≈ 63.29", () => {
			expect(toUSD(50, "GBP", 0.79)).toBeCloseTo(63.29, 1);
		});
	});

	describe("crypto to USD (amount * rate)", () => {
		it("converts BTC to USD: 0.5 * 50000 = 25000", () => {
			expect(toUSD(0.5, "BTC", 50000)).toBe(25000);
		});

		it("converts ETH to USD: 2 * 3000 = 6000", () => {
			expect(toUSD(2, "ETH", 3000)).toBe(6000);
		});
	});

	describe("zero/missing rate", () => {
		it("returns 0 for zero rate (no division by zero)", () => {
			expect(toUSD(100, "EUR", 0)).toBe(0);
		});

		it("returns 0 for undefined rate", () => {
			expect(toUSD(100, "EUR", undefined as unknown as number)).toBe(0);
		});

		it("returns 0 for null rate", () => {
			expect(toUSD(100, "EUR", null as unknown as number)).toBe(0);
		});
	});

	describe("negative amounts", () => {
		it("converts negative fiat amount correctly", () => {
			expect(toUSD(-100, "EUR", 0.92)).toBeCloseTo(-108.7, 1);
		});

		it("converts negative crypto amount correctly", () => {
			expect(toUSD(-0.5, "BTC", 50000)).toBe(-25000);
		});
	});
});

describe("fromUSD", () => {
	describe("USD passthrough", () => {
		it("returns amount unchanged for USD", () => {
			expect(fromUSD(100, "USD", 1)).toBe(100);
		});

		it("USD passthrough ignores rate", () => {
			expect(fromUSD(50, "USD", 0)).toBe(50);
		});
	});

	describe("USD to fiat (usdAmount * rate)", () => {
		it("converts USD to ARS: 3.53 * 1415 ≈ 4994.95", () => {
			expect(fromUSD(3.53, "ARS", 1415)).toBeCloseTo(4994.95, 1);
		});

		it("converts USD to EUR: 108.70 * 0.92 ≈ 100", () => {
			expect(fromUSD(108.7, "EUR", 0.92)).toBeCloseTo(100, 0);
		});
	});

	describe("USD to crypto (usdAmount / rate)", () => {
		it("converts USD to BTC: 25000 / 50000 = 0.5", () => {
			expect(fromUSD(25000, "BTC", 50000)).toBe(0.5);
		});

		it("converts USD to ETH: 6000 / 3000 = 2", () => {
			expect(fromUSD(6000, "ETH", 3000)).toBe(2);
		});
	});

	describe("zero/missing rate", () => {
		it("returns 0 for zero rate (no division by zero)", () => {
			expect(fromUSD(100, "EUR", 0)).toBe(0);
		});

		it("returns 0 for undefined rate", () => {
			expect(fromUSD(100, "EUR", undefined as unknown as number)).toBe(0);
		});

		it("returns 0 for null rate", () => {
			expect(fromUSD(100, "EUR", null as unknown as number)).toBe(0);
		});
	});

	describe("negative amounts", () => {
		it("converts negative amount from USD to fiat correctly", () => {
			expect(fromUSD(-3.53, "ARS", 1415)).toBeCloseTo(-4994.95, 1);
		});

		it("converts negative amount from USD to crypto correctly", () => {
			expect(fromUSD(-25000, "BTC", 50000)).toBe(-0.5);
		});
	});
});

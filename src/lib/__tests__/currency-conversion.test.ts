import { describe, expect, it } from "vitest";
import { convertCurrency, type RatesData } from "../currency-conversion";

const ratesData: RatesData = {
	rates: {
		EUR: 0.92,
		ARS: 1415,
		GBP: 0.79,
	},
	cryptoRates: {
		BTC: 50000,
		ETH: 3000,
	},
};

describe("convertCurrency", () => {
	it("returns original amount when from === to", () => {
		expect(convertCurrency(100, "USD", "USD", ratesData)).toBe(100);
	});

	it("same non-USD currency: from === to returns original amount", () => {
		expect(convertCurrency(50, "EUR", "EUR", ratesData)).toBe(50);
	});

	describe("fiat-to-fiat via USD pivot", () => {
		it("converts EUR to ARS", () => {
			// EUR→USD: 100 / 0.92 ≈ 108.70; USD→ARS: 108.70 * 1415 ≈ 153,804
			const result = convertCurrency(100, "EUR", "ARS", ratesData);
			expect(result).toBeCloseTo(153804, -2);
		});

		it("converts ARS to EUR", () => {
			// ARS→USD: 1415 / 1415 = 1; USD→EUR: 1 * 0.92 = 0.92
			const result = convertCurrency(1415, "ARS", "EUR", ratesData);
			expect(result).toBeCloseTo(0.92, 2);
		});
	});

	describe("crypto-to-crypto via USD pivot", () => {
		it("converts BTC to ETH", () => {
			// BTC→USD: 1 * 50000 = 50000; USD→ETH: 50000 / 3000 ≈ 16.67
			const result = convertCurrency(1, "BTC", "ETH", ratesData);
			expect(result).toBeCloseTo(16.67, 1);
		});
	});

	describe("fiat-to-crypto", () => {
		it("converts USD to BTC", () => {
			// USD→BTC: 50000 / 50000 = 1
			const result = convertCurrency(50000, "USD", "BTC", ratesData);
			expect(result).toBe(1);
		});

		it("converts EUR to BTC", () => {
			// EUR→USD: 100 / 0.92 ≈ 108.70; USD→BTC: 108.70 / 50000
			const result = convertCurrency(100, "EUR", "BTC", ratesData);
			expect(result).toBeCloseTo(108.7 / 50000, 6);
		});
	});

	describe("crypto-to-fiat", () => {
		it("converts BTC to USD", () => {
			// BTC→USD: 1 * 50000 = 50000
			const result = convertCurrency(1, "BTC", "USD", ratesData);
			expect(result).toBe(50000);
		});

		it("converts ETH to EUR", () => {
			// ETH→USD: 1 * 3000 = 3000; USD→EUR: 3000 * 0.92 = 2760
			const result = convertCurrency(1, "ETH", "EUR", ratesData);
			expect(result).toBeCloseTo(2760, 0);
		});
	});

	describe("missing rate handling", () => {
		it("uses rate 1 as fallback for unknown fiat source", () => {
			// Unknown fiat: falls through to rates[from] || 1 → 1
			const result = convertCurrency(100, "XYZ", "USD", ratesData);
			expect(result).toBe(100); // 100 / 1 = 100
		});

		it("uses rate 1 as fallback for unknown fiat target", () => {
			const result = convertCurrency(100, "USD", "XYZ", ratesData);
			expect(result).toBe(100); // 100 * 1 = 100
		});
	});
});

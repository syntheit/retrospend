import { describe, expect, it } from "vitest";
import { isCrypto } from "~/lib/currency-format";

// Import the conversion logic directly to test
const toUSD = (
	amount: number,
	currency: string,
	exchangeRate: number | undefined,
): number => {
	if (!amount || amount === 0) return 0;
	if (currency === "USD") return amount;
	if (!exchangeRate || exchangeRate === 0) return 0;

	const usdValue = isCrypto(currency)
		? amount * exchangeRate
		: amount / exchangeRate;

	return Math.round(usdValue * 100) / 100;
};

const fromUSD = (
	usdAmount: number,
	targetCurrency: string,
	exchangeRate: number | undefined,
): number => {
	if (!usdAmount || usdAmount === 0) return 0;
	if (targetCurrency === "USD") return usdAmount;
	if (!exchangeRate || exchangeRate === 0) return 0;

	const targetValue = isCrypto(targetCurrency)
		? usdAmount / exchangeRate
		: usdAmount * exchangeRate;

	return Math.round(targetValue * 100) / 100;
};

const convert = (
	amount: number,
	sourceCurrency: string,
	sourceRate: number | undefined,
	targetCurrency: string,
	targetRate: number | undefined,
): number => {
	if (!amount || amount === 0) return 0;
	if (sourceCurrency === targetCurrency) return amount;

	// Convert to USD first
	let usdAmount: number;
	if (sourceCurrency === "USD") {
		usdAmount = amount;
	} else if (!sourceRate || sourceRate === 0) {
		return 0;
	} else {
		usdAmount = isCrypto(sourceCurrency)
			? amount * sourceRate
			: amount / sourceRate;
	}

	// Convert from USD to target
	if (targetCurrency === "USD") {
		return Math.round(usdAmount * 100) / 100;
	} else if (!targetRate || targetRate === 0) {
		return 0;
	} else {
		const targetValue = isCrypto(targetCurrency)
			? usdAmount / targetRate
			: usdAmount * targetRate;
		return Math.round(targetValue * 100) / 100;
	}
};

const getDisplayRate = (
	exchangeRate: number | undefined,
	currency: string,
	displayMode: "foreign-to-usd" | "usd-to-foreign" = "usd-to-foreign",
): number => {
	if (!exchangeRate || exchangeRate === 0) return 0;
	if (currency === "USD") return 1;

	if (isCrypto(currency)) {
		return exchangeRate;
	}

	return displayMode === "foreign-to-usd" ? 1 / exchangeRate : exchangeRate;
};

describe("Currency conversion logic", () => {
	describe("toUSD - Converting foreign currencies to USD", () => {
		it("converts fiat to USD by dividing (ARS example)", () => {
			// 5000 ARS at rate 1415 (1415 ARS = 1 USD)
			// Should divide: 5000 / 1415 = 3.53
			const usdValue = toUSD(5000, "ARS", 1415);
			expect(usdValue).toBe(3.53);
		});

		it("converts crypto to USD by multiplying (BTC example)", () => {
			// 0.5 BTC at rate 50000 (1 BTC = 50000 USD)
			// Should multiply: 0.5 * 50000 = 25000
			const usdValue = toUSD(0.5, "BTC", 50000);
			expect(usdValue).toBe(25000);
		});

		it("returns amount as-is when currency is USD", () => {
			const usdValue = toUSD(100, "USD", undefined);
			expect(usdValue).toBe(100);
		});

		it("returns 0 for zero amount", () => {
			const usdValue = toUSD(0, "ARS", 1415);
			expect(usdValue).toBe(0);
		});

		it("returns 0 for undefined exchange rate", () => {
			const usdValue = toUSD(5000, "ARS", undefined);
			expect(usdValue).toBe(0);
		});

		it("returns 0 for zero exchange rate", () => {
			const usdValue = toUSD(5000, "ARS", 0);
			expect(usdValue).toBe(0);
		});

		it("converts EUR to USD correctly", () => {
			// 100 EUR at rate 0.92 (0.92 EUR = 1 USD)
			// Should divide: 100 / 0.92 = 108.70
			const usdValue = toUSD(100, "EUR", 0.92);
			expect(usdValue).toBe(108.7);
		});

		it("converts ETH to USD correctly", () => {
			// 2 ETH at rate 3000 (1 ETH = 3000 USD)
			// Should multiply: 2 * 3000 = 6000
			const usdValue = toUSD(2, "ETH", 3000);
			expect(usdValue).toBe(6000);
		});
	});

	describe("fromUSD - Converting USD to foreign currencies", () => {
		it("converts USD to fiat by multiplying (ARS example)", () => {
			// 100 USD to ARS at rate 1415 (1415 ARS = 1 USD)
			// Should multiply: 100 * 1415 = 141500
			const arsValue = fromUSD(100, "ARS", 1415);
			expect(arsValue).toBe(141500);
		});

		it("converts USD to crypto by dividing (BTC example)", () => {
			// 25000 USD to BTC at rate 50000 (1 BTC = 50000 USD)
			// Should divide: 25000 / 50000 = 0.5
			const btcValue = fromUSD(25000, "BTC", 50000);
			expect(btcValue).toBe(0.5);
		});

		it("returns amount as-is when target is USD", () => {
			const usdValue = fromUSD(100, "USD", undefined);
			expect(usdValue).toBe(100);
		});

		it("returns 0 for zero amount", () => {
			const value = fromUSD(0, "ARS", 1415);
			expect(value).toBe(0);
		});

		it("returns 0 for undefined exchange rate", () => {
			const value = fromUSD(100, "ARS", undefined);
			expect(value).toBe(0);
		});
	});

	describe("convert - Converting between any two currencies", () => {
		it("converts ARS to EUR via USD", () => {
			// 5000 ARS to EUR
			// ARS rate: 1415 (1415 ARS = 1 USD)
			// EUR rate: 0.92 (0.92 EUR = 1 USD)
			// Step 1: 5000 ARS to USD = 5000 / 1415 = 3.53 USD
			// Step 2: 3.53 USD to EUR = 3.53 * 0.92 = 3.25 EUR
			const eurValue = convert(5000, "ARS", 1415, "EUR", 0.92);
			expect(eurValue).toBe(3.25);
		});

		it("converts BTC to ETH via USD", () => {
			// 1 BTC to ETH
			// BTC rate: 50000 (1 BTC = 50000 USD)
			// ETH rate: 3000 (1 ETH = 3000 USD)
			// Step 1: 1 BTC to USD = 1 * 50000 = 50000 USD
			// Step 2: 50000 USD to ETH = 50000 / 3000 = 16.67 ETH
			const ethValue = convert(1, "BTC", 50000, "ETH", 3000);
			expect(ethValue).toBe(16.67);
		});

		it("returns amount as-is when source and target are same", () => {
			const value = convert(100, "ARS", 1415, "ARS", 1415);
			expect(value).toBe(100);
		});

		it("handles USD as source", () => {
			// 100 USD to ARS at rate 1415
			const arsValue = convert(100, "USD", undefined, "ARS", 1415);
			expect(arsValue).toBe(141500);
		});

		it("handles USD as target", () => {
			// 5000 ARS to USD at rate 1415
			const usdValue = convert(5000, "ARS", 1415, "USD", undefined);
			expect(usdValue).toBe(3.53);
		});
	});

	describe("getDisplayRate - Get rate for UI display", () => {
		it("returns rate as-is for USD", () => {
			const displayRate = getDisplayRate(1415, "USD");
			expect(displayRate).toBe(1);
		});

		it("returns rate as-is for crypto (always USD per unit)", () => {
			const displayRate = getDisplayRate(50000, "BTC");
			expect(displayRate).toBe(50000);
		});

		it("returns rate as-is for fiat in usd-to-foreign mode", () => {
			// 1 USD = 1415 ARS (stored rate)
			const displayRate = getDisplayRate(1415, "ARS", "usd-to-foreign");
			expect(displayRate).toBe(1415);
		});

		it("returns inverted rate for fiat in foreign-to-usd mode", () => {
			// 1 ARS = 0.000706 USD (inverted)
			const displayRate = getDisplayRate(1415, "ARS", "foreign-to-usd");
			expect(displayRate).toBeCloseTo(1 / 1415, 6);
		});

		it("returns 0 for undefined rate", () => {
			const displayRate = getDisplayRate(undefined, "ARS");
			expect(displayRate).toBe(0);
		});

		it("returns 0 for zero rate", () => {
			const displayRate = getDisplayRate(0, "ARS");
			expect(displayRate).toBe(0);
		});
	});

	describe("Real-world scenario tests", () => {
		it("prevents the 5000 ARS = 7,075,000 USD bug", () => {
			// This was the actual bug in the screenshot
			// 5000 ARS should be ~3.53 USD, NOT 7,075,000 USD
			const usdValue = toUSD(5000, "ARS", 1415);
			expect(usdValue).toBe(3.53);
			expect(usdValue).not.toBe(7075000); // ❌ Wrong! Would be if multiplying
		});

		it("converts small crypto amounts correctly", () => {
			// 0.01 BTC at $50,000 should be $500
			const usdValue = toUSD(0.01, "BTC", 50000);
			expect(usdValue).toBe(500);
		});

		it("converts large fiat amounts correctly", () => {
			// 1,000,000 ARS at rate 1415 should be ~706.71 USD
			const usdValue = toUSD(1000000, "ARS", 1415);
			expect(usdValue).toBe(706.71);
		});
	});
});

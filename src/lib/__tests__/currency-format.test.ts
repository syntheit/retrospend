import { describe, expect, it } from "vitest";
import {
	isCrypto,
	formatCurrency,
	getCurrencySymbol,
	getDecimalDigits,
	formatNumber,
	formatPercent,
	parseFormattedNumber,
} from "../currency-format";

describe("isCrypto", () => {
	describe("known fiat currencies return false", () => {
		it("USD is not crypto", () => {
			expect(isCrypto("USD")).toBe(false);
		});

		it("EUR is not crypto", () => {
			expect(isCrypto("EUR")).toBe(false);
		});

		it("GBP is not crypto", () => {
			expect(isCrypto("GBP")).toBe(false);
		});

		it("JPY is not crypto", () => {
			expect(isCrypto("JPY")).toBe(false);
		});

		it("ARS is not crypto", () => {
			expect(isCrypto("ARS")).toBe(false);
		});

		it("BRL is not crypto", () => {
			expect(isCrypto("BRL")).toBe(false);
		});

		it("CAD is not crypto", () => {
			expect(isCrypto("CAD")).toBe(false);
		});

		it("CHF is not crypto", () => {
			expect(isCrypto("CHF")).toBe(false);
		});
	});

	describe("crypto codes return true", () => {
		it("BTC is crypto", () => {
			expect(isCrypto("BTC")).toBe(true);
		});

		it("ETH is crypto", () => {
			expect(isCrypto("ETH")).toBe(true);
		});

		it("SOL is crypto", () => {
			expect(isCrypto("SOL")).toBe(true);
		});

		it("USDT is crypto (not in fiat list)", () => {
			expect(isCrypto("USDT")).toBe(true);
		});

		it("DOGE is crypto", () => {
			expect(isCrypto("DOGE")).toBe(true);
		});
	});

	describe("case sensitivity", () => {
		it("lowercase 'usd' is treated as fiat (uppercased internally)", () => {
			expect(isCrypto("usd")).toBe(false);
		});

		it("lowercase 'btc' is treated as crypto", () => {
			expect(isCrypto("btc")).toBe(true);
		});

		it("mixed case 'Usd' is treated as fiat", () => {
			expect(isCrypto("Usd")).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("2-char code not in fiat list is treated as crypto", () => {
			expect(isCrypto("XX")).toBe(true);
		});

		it("4-char code not in fiat list is treated as crypto", () => {
			expect(isCrypto("USDT")).toBe(true);
		});
	});
});

describe("formatCurrency", () => {
	describe("fiat formatting", () => {
		it("formats USD with dollar sign and 2 decimals", () => {
			expect(formatCurrency(1234.56, "USD")).toBe("$1,234.56");
		});

		it("formats negative USD amount (symbol prepended before minus)", () => {
			// The implementation returns "${symbol}${formattedNumber}", so
			// Intl.NumberFormat("-45.00") → "$-45.00", not "-$45.00"
			expect(formatCurrency(-45, "USD")).toBe("$-45.00");
		});

		it("formats zero as $0.00 for USD", () => {
			expect(formatCurrency(0, "USD")).toBe("$0.00");
		});

		it("formats JPY with 0 decimal places (smart formatting)", () => {
			const result = formatCurrency(1235, "JPY");
			// Should not contain decimal point due to 0 decimal_digits
			expect(result).not.toContain(".");
			expect(result).toContain("1,235");
		});

		it("formats GBP with pound symbol", () => {
			const result = formatCurrency(100, "GBP");
			expect(result).toContain("£");
			expect(result).toContain("100.00");
		});
	});

	describe("crypto formatting", () => {
		it("formats BTC with ticker appended", () => {
			const result = formatCurrency(0.5, "BTC");
			expect(result).toContain("BTC");
			expect(result).toContain("0.5");
		});

		it("formats ETH with ticker appended", () => {
			const result = formatCurrency(1.23456789, "ETH");
			expect(result).toContain("ETH");
		});

		it("crypto format has space before ticker", () => {
			const result = formatCurrency(1, "BTC");
			expect(result).toMatch(/\d BTC$/);
		});

		it("crypto uses up to 8 decimal places", () => {
			const result = formatCurrency(0.00000001, "BTC");
			expect(result).toContain("0.00000001");
		});
	});
});

describe("getDecimalDigits", () => {
	it("returns 2 for standard fiat (USD)", () => {
		expect(getDecimalDigits("USD")).toBe(2);
	});

	it("returns 0 for smart no-decimal currencies (JPY)", () => {
		expect(getDecimalDigits("JPY")).toBe(0);
	});

	it("returns 0 for KRW with smart formatting", () => {
		expect(getDecimalDigits("KRW")).toBe(0);
	});

	it("returns 0 for JPY even when smart=false (decimal_digits in CURRENCIES is 0)", () => {
		expect(getDecimalDigits("JPY", false)).toBe(0);
	});

	it("returns 8 for standard crypto (BTC)", () => {
		expect(getDecimalDigits("BTC")).toBe(8);
	});

	it("returns 8 for ETH", () => {
		expect(getDecimalDigits("ETH")).toBe(8);
	});

	it("returns 2 for stablecoins (USDC)", () => {
		expect(getDecimalDigits("USDC")).toBe(2);
	});

	it("returns 2 for USDT", () => {
		expect(getDecimalDigits("USDT")).toBe(2);
	});

	it("is case-insensitive", () => {
		expect(getDecimalDigits("btc")).toBe(8);
		expect(getDecimalDigits("usd")).toBe(2);
	});
});

describe("formatNumber", () => {
	it("formats with thousands separator", () => {
		expect(formatNumber(15000, 2)).toBe("15,000.00");
	});

	it("formats zero", () => {
		expect(formatNumber(0, 2)).toBe("0.00");
	});

	it("formats large numbers", () => {
		expect(formatNumber(1234567.89, 2)).toBe("1,234,567.89");
	});

	it("formats with 0 decimals", () => {
		expect(formatNumber(1235, 0)).toBe("1,235");
	});

	it("formats with 8 decimals for crypto", () => {
		expect(formatNumber(0.00000001, 8)).toBe("0.00000001");
	});

	it("rounds to specified decimals", () => {
		expect(formatNumber(1.999, 2)).toBe("2.00");
	});

	it("handles negative numbers", () => {
		expect(formatNumber(-1500, 2)).toBe("-1,500.00");
	});
});

describe("formatPercent", () => {
	it("formats a percentage with default 1 decimal", () => {
		expect(formatPercent(12.3)).toBe("12.3%");
	});

	it("formats with 0 decimals", () => {
		expect(formatPercent(12.3, 0)).toBe("12%");
	});

	it("formats negative percentages", () => {
		expect(formatPercent(-5.5)).toBe("-5.5%");
	});
});

describe("parseFormattedNumber", () => {
	it("parses plain number", () => {
		expect(parseFormattedNumber("123.45")).toBe(123.45);
	});

	it("strips commas and parses", () => {
		expect(parseFormattedNumber("15,000.00")).toBe(15000);
	});

	it("handles large formatted numbers", () => {
		expect(parseFormattedNumber("1,234,567.89")).toBe(1234567.89);
	});

	it("returns NaN for empty string", () => {
		expect(parseFormattedNumber("")).toBeNaN();
	});

	it("returns NaN for non-numeric", () => {
		expect(parseFormattedNumber("abc")).toBeNaN();
	});
});

describe("getCurrencySymbol", () => {
	it("returns $ for USD", () => {
		expect(getCurrencySymbol("USD")).toBe("$");
	});

	it("returns £ for GBP", () => {
		expect(getCurrencySymbol("GBP")).toBe("£");
	});

	it("falls back to uppercase code for unknown currency", () => {
		expect(getCurrencySymbol("BTC")).toBe("BTC");
	});

	it("lowercased currency is normalized to uppercase for fallback", () => {
		expect(getCurrencySymbol("btc")).toBe("BTC");
	});
});

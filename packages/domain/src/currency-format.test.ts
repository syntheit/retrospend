import { describe, expect, it } from "vitest";
import {
	isCrypto,
	formatCompactAmount,
	formatCurrency,
	getCurrencySymbol,
	getCurrencySymbolWithPreference,
	getDecimalDigits,
	formatNumber,
	formatPercent,
	parseFormattedNumber,
} from "./currency-format";

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
		it("unknown code (not in the crypto allowlist) is NOT treated as crypto", () => {
			// isCrypto checks an explicit crypto allowlist, so a made-up code is not
			// assumed to be a cryptocurrency.
			expect(isCrypto("XX")).toBe(false);
		});

		it("known stablecoin USDT is crypto", () => {
			expect(isCrypto("USDT")).toBe(true);
		});
	});
});

describe("formatCurrency", () => {
	describe("fiat formatting", () => {
		it("formats USD with dollar sign and 2 decimals", () => {
			expect(formatCurrency(1234.56, "USD")).toBe("$1,234.56");
		});

		it("puts the minus sign before the currency symbol", () => {
			expect(formatCurrency(-45, "USD")).toBe("-$45.00");
			expect(formatCurrency(-2236000, "ARS")).toBe("-AR$2,236,000");
			expect(formatCurrency(-1234.5, "EUR")).toBe("-€1.234,50");
			expect(formatCurrency(-0.004, "ETH")).toBe("-0.004 ETH");
		});

		it("drops the sign when the amount rounds to zero", () => {
			expect(formatCurrency(-0.001, "USD")).toBe("$0.00");
		});

		it("shows a plus sign with exceptZero", () => {
			expect(formatCurrency(12, "USD", "standard", true, "exceptZero")).toBe(
				"+$12.00",
			);
			expect(formatCurrency(-12, "USD", "standard", true, "exceptZero")).toBe(
				"-$12.00",
			);
			expect(formatCurrency(0, "USD", "standard", true, "exceptZero")).toBe(
				"$0.00",
			);
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

describe("formatCompactAmount", () => {
	const ars = getCurrencySymbolWithPreference("ARS", "standard");

	it("labels a peso axis as pesos, not dollars", () => {
		expect(ars).toBe("AR$");
		expect(formatCompactAmount(1_000_000, ars)).toBe("AR$1M");
		expect(formatCompactAmount(250_000, ars)).toBe("AR$250K");
		expect(formatCompactAmount(0, ars)).toBe("AR$0");
	});

	it("puts the sign before the symbol", () => {
		expect(formatCompactAmount(-1_500_000, ars)).toBe("-AR$1.5M");
	});
});

// The account's number format swaps the group and decimal marks and keeps the
// language's pattern. Expected strings are written out by hand. U+202F is the
// narrow no-break space of the space_comma choice.
describe("number format override", () => {
	const NN = " ";

	it("follows the language when no format is set", () => {
		expect(formatCurrency(1234.56, "EUR")).toBe("€1.234,56");
		expect(formatCurrency(1234.56, "USD", "standard", true, "auto", null)).toBe(
			"$1,234.56",
		);
	});

	it("swaps only the marks, in each choice", () => {
		const f = (c: Parameters<typeof formatCurrency>[5]) =>
			formatCurrency(1234.56, "USD", "standard", true, "auto", c);
		expect(f("comma_dot")).toBe("$1,234.56");
		expect(f("dot_comma")).toBe("$1.234,56");
		expect(f("space_comma")).toBe(`$1${NN}234,56`);
	});

	it("keeps the language's sign and symbol position", () => {
		expect(
			formatCurrency(-1234.5, "EUR", "standard", true, "auto", "comma_dot"),
		).toBe("-€1,234.50");
		expect(
			formatCurrency(
				1234.5,
				"EUR",
				"standard",
				true,
				"exceptZero",
				"dot_comma",
			),
		).toBe("+€1.234,50");
	});

	it("replaces a language's own group mark (Swiss apostrophe)", () => {
		expect(formatCurrency(1920.3, "CHF")).toBe("CHF1'920.30");
		expect(
			formatCurrency(1920.3, "CHF", "standard", true, "auto", "dot_comma"),
		).toBe("CHF1.920,30");
	});

	it("keeps smart places for JPY and ARS", () => {
		expect(
			formatCurrency(1234567, "JPY", "standard", true, "auto", "dot_comma"),
		).toBe("¥1.234.567");
		expect(
			formatCurrency(1920.3, "ARS", "standard", true, "auto", "space_comma"),
		).toBe(`AR$1${NN}920`);
	});

	it("swaps crypto marks", () => {
		expect(
			formatCurrency(0.12345678, "BTC", "standard", true, "auto", "dot_comma"),
		).toBe("0,12345678 BTC");
		expect(
			formatCurrency(12345.5, "BTC", "standard", true, "auto", "dot_comma"),
		).toBe("12.345,50 BTC");
	});

	it("swaps the compact axis mark", () => {
		expect(formatCompactAmount(1_234_567, "$", "en-US-x-nf-dc")).toBe("$1,2M");
		expect(formatCompactAmount(-1_500_000, "AR$", "en-US-x-nf-cd")).toBe(
			"-AR$1.5M",
		);
	});
});

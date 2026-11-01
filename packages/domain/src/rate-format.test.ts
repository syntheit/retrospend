import { describe, expect, it } from "vitest";
import {
	formatRate,
	formatRateValue,
	formatRateWithType,
	orientRate,
	orientRateAs,
} from "./rate-format";

describe("formatRate: a weak currency against a strong one", () => {
	it("reads ARS per USD as is when the home is the weak currency", () => {
		expect(formatRate("USD", "ARS", "1545.2")).toBe("1 USD = 1,545.20 ARS");
		expect(formatRate("USD", "ARS", 1545.2)).toBe("1 USD = 1,545.20 ARS");
	});

	it("flips the weak currency's tiny rate so it never reads 0.00", () => {
		// Home USD, spent in ARS: 1 ARS = 0.000647 USD.
		expect(formatRate("ARS", "USD", "0.000647128")).toBe(
			"1 USD = 1,545.29 ARS",
		);
		expect(formatRate("BRL", "USD", "0.185185185185")).toBe("1 USD = 5.40 BRL");
	});
});

describe("formatRate: both directions of one pair agree", () => {
	it("gives the same line from either side", () => {
		const a = formatRate("USD", "BRL", "5.4");
		const b = formatRate("BRL", "USD", 1 / 5.4);
		expect(a).toBe("1 USD = 5.40 BRL");
		expect(b).toBe(a);
	});

	it("keeps a strong currency's rate above one as it is", () => {
		expect(formatRate("EUR", "USD", "1.0834")).toBe("1 EUR = 1.0834 USD");
		expect(formatRate("USD", "EUR", 1 / 1.0834)).toBe("1 EUR = 1.0834 USD");
		expect(formatRate("BTC", "USD", "64545.123")).toBe("1 BTC = 64,545.12 USD");
		expect(formatRate("USD", "BTC", "0.0000154936")).toBe(
			"1 BTC = 64,542.78 USD",
		);
	});

	it("keeps from as the base at exactly 1", () => {
		expect(orientRate("USD", "USDC", 1)).toEqual({
			base: "USD",
			quote: "USDC",
			value: 1,
		});
		expect(formatRate("USD", "USDC", 1)).toBe("1 USD = 1.00 USDC");
	});

	it("uppercases the codes", () => {
		expect(formatRate("usd", "ars", "1500")).toBe("1 USD = 1,500.00 ARS");
	});
});

describe("formatRate: a missing rate is never 1", () => {
	it("returns null for no, zero, negative or unreadable rates", () => {
		expect(formatRate("USD", "ARS", null)).toBeNull();
		expect(formatRate("USD", "ARS", undefined)).toBeNull();
		expect(formatRate("USD", "ARS", "")).toBeNull();
		expect(formatRate("USD", "ARS", 0)).toBeNull();
		expect(formatRate("USD", "ARS", "0")).toBeNull();
		expect(formatRate("USD", "ARS", -3)).toBeNull();
		expect(formatRate("USD", "ARS", "abc")).toBeNull();
		expect(formatRate("USD", "ARS", Number.NaN)).toBeNull();
		expect(formatRate("USD", "ARS", Number.POSITIVE_INFINITY)).toBeNull();
	});

	it("gives no type line without a rate, so a type is never alone", () => {
		expect(formatRateWithType("Blue", "USD", "ARS", null)).toBeNull();
	});
});

describe("formatRateWithType", () => {
	it("puts the type before the rate", () => {
		expect(formatRateWithType("Blue", "USD", "ARS", "1545.2")).toBe(
			"Blue · 1 USD = 1,545.20 ARS",
		);
		expect(formatRateWithType("Official", "ARS", "USD", "0.00093")).toBe(
			"Official · 1 USD = 1,075.27 ARS",
		);
	});

	it("leaves the dot out when there is no type name", () => {
		expect(formatRateWithType("", "USD", "BRL", 5.4)).toBe("1 USD = 5.40 BRL");
	});
});

describe("formatRateValue: decimals and the locale's marks", () => {
	it("shows 2 decimals from 100 up and 2 to 4 below", () => {
		expect(formatRateValue(1545.2013)).toBe("1,545.20");
		expect(formatRateValue(150.256)).toBe("150.26");
		expect(formatRateValue(5.4)).toBe("5.40");
		expect(formatRateValue(5.40123)).toBe("5.4012");
		expect(formatRateValue(1.0834)).toBe("1.0834");
	});

	it("keeps digits below 1 so a pinned weak direction never reads 0.00", () => {
		expect(formatRateValue(0.000647128)).toBe("0.00064713");
		expect(formatRateValue(0.5)).toBe("0.50");
	});

	it("follows the locale", () => {
		expect(formatRateValue(1545.2, "es-AR")).toBe("1.545,20");
		expect(formatRateValue(5.4, "de-DE")).toBe("5,40");
		expect(formatRate("USD", "ARS", "1545.2", "es-AR")).toBe(
			"1 USD = 1.545,20 ARS",
		);
	});

	it("follows the account's separator choice riding on the locale", () => {
		expect(formatRateValue(1545.2, "en-US-x-nf-dc")).toBe("1.545,20");
	});
});

describe("orientRateAs: one direction for a row of rates", () => {
	it("reads every type of a pair with the same base", () => {
		expect(orientRateAs("USD", "ARS", "USD", 1545.2)?.value).toBeCloseTo(
			1 / 1545.2,
			10,
		);
		expect(orientRateAs("USD", "USD", "ARS", 1545.2)).toEqual({
			base: "USD",
			quote: "ARS",
			value: 1545.2,
		});
	});

	it("refuses a base outside the pair and a missing rate", () => {
		expect(orientRateAs("EUR", "USD", "ARS", 1545.2)).toBeNull();
		expect(orientRateAs("USD", "USD", "ARS", null)).toBeNull();
	});
});

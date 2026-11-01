import { describe, expect, it } from "vitest";
import {
	formatRate,
	formatRateValue,
	formatRateWithType,
	orientRate,
	orientRateAs,
	rateDirection,
	storedRateToTyped,
	typedRateToStored,
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

describe("typing a custom rate the way it reads", () => {
	// Home ARS, spending USD: stored 1545.2 ARS per USD; reads "1 USD = 1,545.20 ARS".
	it("types a strong foreign currency in the stored direction", () => {
		const d = rateDirection("USD", "ARS", "1545.2");
		expect(d).toEqual({ base: "USD", quote: "ARS", flipped: false });
		expect(typedRateToStored("1545.2", d.flipped, "en-US")).toBe("1545.2");
		expect(typedRateToStored("1.545,25", d.flipped, "es-AR")).toBe("1545.25");
		expect(storedRateToTyped("1545.2", d.flipped, "en-US")).toBe("1545.2");
		expect(storedRateToTyped("1545.2", d.flipped, "es-AR")).toBe("1545,2");
	});

	// Home USD, spending ARS: stored 0.000647 USD per ARS; reads "1 USD = 1,545.20 ARS".
	it("types a weak foreign currency as the >= 1 number and inverts it", () => {
		const d = rateDirection("ARS", "USD", "0.00064716");
		expect(d).toEqual({ base: "USD", quote: "ARS", flipped: true });
		const stored = typedRateToStored("1545.2", d.flipped, "en-US");
		expect(stored).toBe("0.000647165415");
		// Shown and prefilled as the same number the person typed.
		expect(storedRateToTyped(stored, d.flipped, "en-US")).toBe("1545.2");
		expect(formatRate("ARS", "USD", stored)).toBe("1 USD = 1,545.20 ARS");
	});

	it("round trips every direction without drifting", () => {
		const cases: [string, string, string, string][] = [
			["USD", "ARS", "1545.2", "1545.2"],
			["ARS", "USD", "0.000647", "1545.2"],
			["EUR", "USD", "1.0834", "1.0834"],
			["USD", "EUR", "0.9231", "1.0834"],
			["BRL", "ARS", "270.5", "270.5"],
			["ARS", "BRL", "0.0037", "270.5"],
			["USD", "VND", "25000", "25000"],
			["VND", "USD", "0.00004", "25000"],
			["BTC", "USD", "64545.12", "64545.12"],
			["USD", "BTC", "0.0000155", "64545.12"],
		];
		for (const [from, to, reference, typed] of cases) {
			const d = rateDirection(from, to, reference);
			const stored = typedRateToStored(typed, d.flipped, "en-US");
			expect(stored, `${from}->${to}`).not.toBeNull();
			expect(storedRateToTyped(stored, d.flipped, "en-US"), `${from}->${to}`).toBe(
				typed,
			);
		}
	});

	it("shows the saved number on edit: the booked rate reads the way it was typed", () => {
		// Saved from a typed 1,545.2 in a USD home for ARS spending.
		const saved = typedRateToStored("1545.2", true, "en-US");
		const d = rateDirection("ARS", "USD", saved);
		expect(storedRateToTyped(saved, d.flipped, "en-US")).toBe("1545.2");
	});

	it("reads a number the server sent as a number", () => {
		expect(storedRateToTyped(1545.2, false)).toBe("1545.2");
		expect(storedRateToTyped(0.5, true)).toBe("2");
	});

	it("gives null for empty, zero, negative and garbage input", () => {
		for (const flipped of [false, true]) {
			for (const text of ["", " ", "0", "0.00", "-5", "abc", "1.2.3", "1e5"]) {
				expect(typedRateToStored(text, flipped, "en-US"), text).toBeNull();
			}
		}
		// Too large to invert to a rate above zero at 12 places.
		expect(typedRateToStored("9999999999999", true, "en-US")).toBeNull();
	});

	it("reads without a reference in the stored direction", () => {
		expect(rateDirection("USD", "ARS", null)).toEqual({
			base: "USD",
			quote: "ARS",
			flipped: false,
		});
		expect(storedRateToTyped(null, false)).toBe("");
		expect(storedRateToTyped("0", true)).toBe("");
	});
});

import { describe, expect, it } from "vitest";
import {
	CURRENCY_LOCKED,
	excessDecimals,
	legChangeMessage,
	noRateFound,
	SIDE_LOCKED,
} from "./refusals";

describe("legChangeMessage", () => {
	const usdCash = { currency: "USD", type: "CASH" };

	it("names the currency before the side when both change", () => {
		expect(
			legChangeMessage(usdCash, { currency: "ARS", type: "LIABILITY_LOAN" }),
		).toBe(CURRENCY_LOCKED);
	});

	it("refuses a move across net worth: something you have becomes something you owe", () => {
		expect(
			legChangeMessage(usdCash, { currency: "USD", type: "LIABILITY_CARD" }),
		).toBe(SIDE_LOCKED);
		expect(
			legChangeMessage(
				{ currency: "USD", type: "LIABILITY_LOAN" },
				{ currency: "USD", type: "CASH" },
			),
		).toBe(SIDE_LOCKED);
	});

	it("allows a change within a side", () => {
		expect(
			legChangeMessage(usdCash, { currency: "USD", type: "INVESTMENT" }),
		).toBeNull();
		expect(
			legChangeMessage(
				{ currency: "USD", type: "LIABILITY_LOAN" },
				{ currency: "USD", type: "LIABILITY_MORTGAGE" },
			),
		).toBeNull();
	});
});

describe("excessDecimals", () => {
	it("refuses more decimals than the currency has, never rounding", () => {
		expect(excessDecimals("10.123", "USD", "balance")).toBe(
			"balance 10.123 has more decimals than USD allows (2)",
		);
		// JPY has none.
		expect(excessDecimals("100.5", "JPY")).toBe(
			"amount 100.5 has more decimals than JPY allows (0)",
		);
	});

	it("allows as many as the currency has, and nothing typed", () => {
		expect(excessDecimals("10.12", "USD")).toBeNull();
		expect(excessDecimals("100", "JPY")).toBeNull();
		expect(excessDecimals("", "USD")).toBeNull();
		expect(excessDecimals(null, "USD")).toBeNull();
		expect(excessDecimals(undefined, "USD")).toBeNull();
	});
});

describe("noRateFound", () => {
	it("says the server's words", () => {
		expect(noRateFound("BRL")).toBe(
			"No exchange rate found for BRL. Please sync rates or provide a custom rate.",
		);
	});
});

import {
	amountMinor,
	customRateOf,
	DEFAULT_RATE,
	type RateChoice,
	rateFields,
} from "./draftAmount";

// The amount and the rate every draft shares, tested on their own: the
// currencies with no decimals (JPY) and with three (KWD) are where a figure
// written as if every currency had two goes wrong.

const custom = (over: Partial<RateChoice>): RateChoice => ({
	...DEFAULT_RATE,
	custom: true,
	...over,
});

describe("amountMinor", () => {
	it("reads a zero-decimal currency in whole units", () => {
		expect(amountMinor("1,500", "en-US", "JPY")).toBe(1500);
		expect(amountMinor("1500", "en-US", "JPY")).toBe(1500);
		expect(amountMinor("1.500", "es-AR", "JPY")).toBe(1500);
	});

	it("reads a three-decimal currency to the thousandth", () => {
		expect(amountMinor("12.345", "en-US", "KWD")).toBe(12_345);
		expect(amountMinor("12", "en-US", "KWD")).toBe(12_000);
		expect(amountMinor("0.001", "en-US", "KWD")).toBe(1);
		expect(amountMinor("1.234,567", "es-AR", "KWD")).toBe(1_234_567);
	});

	it("reads a two-decimal currency to the cent", () => {
		expect(amountMinor("12.5", "en-US", "USD")).toBe(1250);
		expect(amountMinor("12,50", "es-AR", "USD")).toBe(1250);
	});

	it("reads nothing from an empty, zero or unreadable text", () => {
		for (const currency of ["JPY", "KWD", "USD"]) {
			expect(amountMinor("", "en-US", currency)).toBeNull();
			expect(amountMinor("0", "en-US", currency)).toBeNull();
			expect(amountMinor("abc", "en-US", currency)).toBeNull();
		}
	});

	it("refuses more decimals than the currency has, never rounding them", () => {
		expect(amountMinor("0.5", "en-US", "JPY")).toBeNull();
		expect(amountMinor("1.5", "en-US", "JPY")).toBeNull();
		expect(amountMinor("1.2345", "en-US", "KWD")).toBeNull();
		expect(amountMinor("12.999", "en-US", "USD")).toBeNull();
	});
});

describe("rateFields", () => {
	it("sends nothing for the default: the server books your default type", () => {
		expect(rateFields(DEFAULT_RATE, "en-US")).toEqual({});
	});

	it("sends the picked type", () => {
		expect(rateFields({ ...DEFAULT_RATE, rateType: "mep" }, "en-US")).toEqual({
			rateType: "mep",
		});
	});

	it("sends a typed rate in place of a type", () => {
		expect(
			rateFields(custom({ rateType: "mep", customText: "1465.5" }), "en-US"),
		).toEqual({ customRate: "1465.5" });
	});

	it("reads the typed rate in the person's marks", () => {
		expect(rateFields(custom({ customText: "1.465,5" }), "es-AR")).toEqual({
			customRate: "1465.5",
		});
	});

	it("waits for a rate that reads: never 1, never zero, never empty", () => {
		for (const customText of ["", " ", "0", "0.0", "abc", "-3"]) {
			expect(rateFields(custom({ customText }), "en-US")).toBeNull();
			expect(customRateOf(custom({ customText }), "en-US")).toBeNull();
		}
	});
});

describe("customRateOf", () => {
	it("inverts a typed rate of a currency stored the other way", () => {
		// 1 USD = 4 units of the weak currency is stored as 0.25.
		expect(
			customRateOf(custom({ customText: "4", customFlipped: true }), "en-US"),
		).toBe("0.25");
	});

	it("keeps a saved rate exactly as stored until the person types", () => {
		const opened = custom({
			customText: "1.0834",
			customFlipped: true,
			savedRate: "0.923",
		});
		expect(customRateOf(opened, "es-AR")).toBe("0.923");
		expect(customRateOf({ ...opened, customEdited: true }, "en-US")).not.toBe(
			"0.923",
		);
	});

	it("does not fall back to the saved rate once the field is emptied", () => {
		const emptied = custom({
			customText: "",
			savedRate: "0.923",
			customEdited: true,
		});
		expect(customRateOf(emptied, "en-US")).toBeNull();
	});
});

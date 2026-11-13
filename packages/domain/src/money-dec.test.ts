// Every expected value below is derived by hand in its comment, never copied
// from the code's output. Rates follow the stored convention: fiat in units
// per USD, crypto in USD per coin.
import { describe, expect, it } from "vitest";
import {
	computeAmountInUSD,
	convertAmount,
	roundMoney,
	toAmountString,
	toMinorUnits,
} from "./money";
import {
	columnFromFloat,
	computeAmountInUSDDec,
	convertDec,
	crossRateDec,
	fromUSDDec,
	MissingRateError,
	rateFromUsdAmountDec,
	rateFromUsdPerUnitDec,
	roundMoneyDec,
	roundRateDec,
	roundUSDDec,
	toUSDDec,
	usdPerUnitDec,
} from "./money-dec";
import { roundedMajor, roundedMinor } from "./money-minor";
import { dec, fromFloat, toFloat } from "./precise-decimal";

const fixed = (d: { toFixed(): string }) => d.toFixed();

describe("ties round half to even, sign symmetric, at every precision", () => {
	it("USD (2 decimals)", () => {
		const cases: [string, string][] = [
			["0.025", "0.02"], // 2.5 cents, 2 is even
			["0.035", "0.04"], // 3.5 cents, 4 is even
			["0.295", "0.30"], // 29.5 cents, 30 is even
			["1.005", "1.00"], // 100.5 cents, 100 is even
			["-0.015", "-0.02"], // -1.5 cents, magnitude 2 is even
			["-0.025", "-0.02"], // -2.5 cents, magnitude 2 is even
			["-0.035", "-0.04"], // -3.5 cents, magnitude 4 is even
			["-0.005", "0.00"], // -0.5 cents rounds to 0, never "-0.00"
			["-0.004", "0.00"], // below half a cent, never "-0.00"
			["0.0251", "0.03"], // past the tie: up
		];
		for (const [value, want] of cases) {
			expect(roundUSDDec(value).toFixed(2), value).toBe(want);
			expect(roundMoneyDec(value, "USD").toFixed(2), value).toBe(want);
		}
	});

	it("JPY (0 decimals)", () => {
		expect(fixed(roundMoneyDec("1257.5", "JPY"))).toBe("1258"); // 1257 odd, up to 1258
		expect(fixed(roundMoneyDec("1252.5", "JPY"))).toBe("1252"); // 1252 even, kept
		expect(fixed(roundMoneyDec("-1257.5", "JPY"))).toBe("-1258"); // magnitude 1258
		expect(fixed(roundMoneyDec("-1252.5", "JPY"))).toBe("-1252");
		expect(fixed(roundMoneyDec("-0.5", "JPY"))).toBe("0"); // 0 is even, never "-0"
		expect(fixed(roundMoneyDec("1234.6", "JPY"))).toBe("1235"); // not a tie
	});

	it("KWD (3 decimals)", () => {
		expect(fixed(roundMoneyDec("1.2345", "KWD"))).toBe("1.234"); // 1234.5 fils, 1234 even
		expect(fixed(roundMoneyDec("2.5025", "KWD"))).toBe("2.502"); // 2502.5, 2502 even
		expect(fixed(roundMoneyDec("2.5075", "KWD"))).toBe("2.508"); // 2507.5, 2508 even
		expect(fixed(roundMoneyDec("-1.2345", "KWD"))).toBe("-1.234");
		expect(fixed(roundMoneyDec("-2.5075", "KWD"))).toBe("-2.508");
	});

	it("CLF (4 decimals)", () => {
		expect(fixed(roundMoneyDec("1.2345", "CLF"))).toBe("1.2345"); // already exact
		expect(fixed(roundMoneyDec("1.23445", "CLF"))).toBe("1.2344"); // 12344.5, 12344 even
		expect(fixed(roundMoneyDec("-1.23455", "CLF"))).toBe("-1.2346"); // 12345.5, 12346 even
	});

	it("BTC (8 decimals)", () => {
		expect(fixed(roundMoneyDec("0.000000015", "BTC"))).toBe("0.00000002"); // 1.5 sat, 2 even
		expect(roundMoneyDec("0.000000025", "BTC").toFixed(8)).toBe("0.00000002"); // 2.5 sat, 2
		expect(roundMoneyDec("-0.000000015", "BTC").toFixed(8)).toBe("-0.00000002");
		expect(roundMoneyDec("-0.000000005", "BTC").toFixed(8)).toBe("0.00000000"); // -0.5 sat
	});
});

describe("conversion", () => {
	it("28.5 ARS at 100 per USD is 0.285 USD, stored as 0.28", () => {
		// 28.5 / 100 = 0.285 exactly: 28.5 cents, 28 is even (half up gave 0.29).
		expect(fixed(toUSDDec("28.5", "ARS", 100))).toBe("0.285");
		expect(computeAmountInUSDDec("28.5", "ARS", 100).toFixed(2)).toBe("0.28");
		// A refund: -0.285 USD, magnitude 28.5 cents, 28 even.
		expect(computeAmountInUSDDec("-28.5", "ARS", 100).toFixed(2)).toBe("-0.28");
		// -1.5 / 100 = -0.015: -1.5 cents, magnitude 2 even (half up gave -0.01).
		expect(computeAmountInUSDDec("-1.5", "ARS", 100).toFixed(2)).toBe("-0.02");
	});

	it("0.5 USD of ARS at rate 100 is 0 cents", () => {
		// 0.5 ARS / 100 = 0.005 USD = 0.5 cents, a tie: 0 is even (half up gave 1).
		const usd = computeAmountInUSDDec("0.5", "ARS", 100);
		expect(usd.toFixed(2)).toBe("0.00");
		expect(Object.is(roundedMinor(usd, "USD"), 0)).toBe(true);
	});

	it("4.5 at rate 3 into a JPY home at rate 1 gives 2 JPY", () => {
		// One division: 4.5 x 1 / 3 = 1.5 JPY exactly, a tie, 2 is even. The
		// old float path multiplied by 1/3 = 0.333...3 and got 1.4999...9.
		const jpy = convertDec("4.5", "EUR", 3, "JPY", 1);
		expect(fixed(jpy)).toBe("1.5");
		expect(fixed(roundMoneyDec(jpy, "JPY"))).toBe("2");
		// Its USD value is 4.5 / 3 = 1.50.
		expect(computeAmountInUSDDec("4.5", "EUR", 3).toFixed(2)).toBe("1.50");
	});

	it("an ARS blue home (1 USD = 1545 ARS)", () => {
		// 10.01 x 1545 = 15450 + 15.45 = 15465.45 ARS.
		expect(fixed(fromUSDDec("10.01", "ARS", 1545))).toBe("15465.45");
		// And back: 15465.45 / 1545 = 10.01 USD, no float residue.
		expect(fixed(toUSDDec("15465.45", "ARS", 1545))).toBe("10.01");
		// 100 EUR at 0.9 per USD into ARS: 100 x 1545 / 0.9 = 171666.666...
		// which is 171666.67 at 2 decimals (the 7th digit 6 rounds up).
		expect(
			roundMoneyDec(convertDec(100, "EUR", "0.9", "ARS", 1545), "ARS").toFixed(
				2,
			),
		).toBe("171666.67");
		// The cross rate 1545 / 0.9 = 1716.666..., at 6 decimals 1716.666667.
		expect(
			fixed(roundRateDec(crossRateDec("EUR", "0.9", "ARS", 1545), 6)),
		).toBe("1716.666667");
	});

	it("crypto multiplies by USD per coin", () => {
		// 1 satoshi x 64545.123456 = 0.00064545123456 USD: 0.0645... cents, 0.
		expect(fixed(toUSDDec("0.00000001", "BTC", "64545.123456"))).toBe(
			"0.00064545123456",
		);
		expect(
			computeAmountInUSDDec("0.00000001", "BTC", "64545.123456").toFixed(2),
		).toBe("0.00");
		// 0.5 BTC x 64545.9 = 32272.95 USD; back: 32272.95 / 64545.9 = 0.5.
		expect(fixed(toUSDDec("0.5", "BTC", "64545.9"))).toBe("32272.95");
		expect(fixed(fromUSDDec("32272.95", "BTC", "64545.9"))).toBe("0.5");
	});

	it("an ARS entry into a BTC home (a tiny cross rate)", () => {
		// 1545 ARS = 1 USD = 1 / 64545.123456 BTC. 64545.123456 x 0.00001549 =
		// 0.99980... and x 0.00001550 = 1.00045, so the quotient is
		// 0.0000154930...; at 8 decimals 0.00001549 (next digit 3).
		const btc = convertDec(1545, "ARS", 1545, "BTC", "64545.123456");
		expect(roundMoneyDec(btc, "BTC").toFixed(8)).toBe("0.00001549");
	});

	it("keeps a 19-digit amount times an 18-digit rate exact", () => {
		// Decimal(19,8) x Decimal(18,6): 37 significant digits, 14 decimals,
		// the last one 8 x 6 = 48, so it ends in 8. Dividing back is exact.
		const amount = "12345678901.12345678";
		const rate = "123456789012.123456";
		const usd = toUSDDec(amount, "BTC", rate);
		expect(usd.decimalPlaces()).toBe(14);
		expect(usd.toFixed().endsWith("8")).toBe(true);
		expect(fixed(usd.div(rate))).toBe(amount);
	});

	it("same currency and USD need no rate; a missing one is never 1", () => {
		expect(fixed(convertDec("12.34", "ARS", null, "ARS", undefined))).toBe(
			"12.34",
		);
		expect(fixed(toUSDDec("12.34", "USD", null))).toBe("12.34");
		for (const bad of [null, undefined, 0, -1, Number.NaN, Infinity, "0"])
			expect(() => toUSDDec(1, "ARS", bad)).toThrow(MissingRateError);
		expect(() => fromUSDDec(1, "BTC", undefined)).toThrow(MissingRateError);
		expect(() => convertDec(1, "USD", 1, "JPY", null)).toThrow(
			MissingRateError,
		);
	});

	it("per-unit values and their inverse", () => {
		expect(fixed(usdPerUnitDec("ARS", 2000))).toBe("0.0005"); // 1 / 2000
		expect(fixed(usdPerUnitDec("BTC", 64545))).toBe("64545");
		expect(fixed(usdPerUnitDec("USD", null))).toBe("1");
		expect(fixed(rateFromUsdPerUnitDec("ARS", "0.0005"))).toBe("2000"); // 1 / 0.0005
		expect(fixed(rateFromUsdPerUnitDec("BTC", 64545))).toBe("64545");
	});
});

describe("a rate from a USD amount", () => {
	it("divides once: fiat amount / USD, crypto USD / amount", () => {
		// ARS blue: 15465.45 ARS for 10.01 USD is 15465.45 / 10.01 = 1545.
		expect(fixed(rateFromUsdAmountDec("ARS", "10.01", "15465.45"))).toBe(
			"1545",
		);
		// JPY: 1500 JPY for 10 USD is 150 per USD.
		expect(fixed(rateFromUsdAmountDec("JPY", 10, 1500))).toBe("150");
		// KWD: 3.075 KWD for 10 USD is 0.3075 KWD per USD.
		expect(fixed(rateFromUsdAmountDec("KWD", 10, "3.075"))).toBe("0.3075");
		// BTC: 32272.95 USD for 0.5 BTC is 64545.9 USD per coin.
		expect(fixed(rateFromUsdAmountDec("BTC", "32272.95", "0.5"))).toBe(
			"64545.9",
		);
		// A refund prices the same: -28.5 ARS for -0.285 USD is 100 per USD.
		expect(fixed(rateFromUsdAmountDec("ARS", "-0.285", "-28.5"))).toBe("100");
		expect(fixed(rateFromUsdAmountDec("USD", 5, 7))).toBe("1");
	});

	it("keeps the quotient to 40 digits, rounded once at the column", () => {
		// 7 ARS for 0.015 USD: 7 / 0.015 = 466.666..., 466.666667 at 6
		// decimals (the 7th digit 6 rounds up).
		const rate = rateFromUsdAmountDec("ARS", "0.015", 7);
		expect(rate.toFixed(6)).toBe("466.666667");
		expect(rate.precision()).toBe(40);
	});

	it("no finite rate above zero is MissingRateError, never 1", () => {
		for (const [usd, amount] of [
			[0, 10], // 10 / 0
			[10, 0], // 0 / 10 is a rate of 0
			[0, 0],
			["-1", 10], // signs differ
		] as const)
			expect(() => rateFromUsdAmountDec("ARS", usd, amount)).toThrow(
				MissingRateError,
			);
		expect(() => rateFromUsdAmountDec("BTC", 10, 0)).toThrow(MissingRateError);
	});
});

describe("rates at a column's scale", () => {
	it("rounds half to even at 6 and 12 decimals", () => {
		expect(fixed(roundRateDec(dec(1).div(3), 6))).toBe("0.333333");
		expect(fixed(roundRateDec("0.0000005", 6))).toBe("0"); // 0.5e-6, 0 even
		expect(fixed(roundRateDec("0.0000015", 6))).toBe("0.000002"); // 1.5e-6, 2 even
		expect(fixed(roundRateDec("0.0000000000025", 12))).toBe("0.000000000002"); // 2.5e-12, 2 even
	});

	it("reads a 6-decimal rate held as a number exactly", () => {
		for (const s of [
			"1545.123456",
			"64545.123456",
			"0.000001",
			"0.000017",
			"0.310245",
		])
			expect(dec(Number(s)).toFixed(), s).toBe(s);
	});
});

describe("the number edge", () => {
	it("fromFloat trims float noise to 15 significant digits", () => {
		// 1.005 x 100 is 100.49999999999999 as a float; meant 100.5.
		expect(fixed(fromFloat(1.005 * 100))).toBe("100.5");
		expect(fixed(fromFloat(0.1 + 0.2))).toBe("0.3");
	});

	it("roundedMinor rounds an exact decimal once", () => {
		expect(roundedMinor("12.73333333", "USD")).toBe(1273);
		// Three such shares sum to 38.19999999: 3820 once, not 3 x 1273 = 3819.
		expect(roundedMinor("38.19999999", "USD")).toBe(3820);
		expect(Object.is(roundedMinor("-0.004", "USD"), 0)).toBe(true);
		expect(roundedMinor("0.000000025", "BTC")).toBe(2); // 2.5 sat, 2 even
		expect(roundedMinor("1257.5", "JPY")).toBe(1258);
		expect(roundedMinor("-1.2345", "KWD")).toBe(-1234);
	});

	it("roundedMajor rounds half to even once, and never reads -0", () => {
		expect(roundedMajor("1.545", "ARS")).toBe(1.54); // 154.5 cents, 154 even
		expect(roundedMajor("4.635", "ARS")).toBe(4.64); // 463.5 cents, 464 even
		expect(roundedMajor("-1.545", "ARS")).toBe(-1.54);
		expect(Object.is(roundedMajor("-0.004", "USD"), 0)).toBe(true);
		expect(roundedMajor("1257.5", "JPY")).toBe(1258);
		expect(roundedMajor("0.016666666666", "BTC")).toBe(0.01666667);
		// A 14 digit result survives the float; .345 is a tie, 4 even.
		expect(roundedMajor("123456789012.345", "USD")).toBe(123456789012.34);
	});

	it("toFloat with significant digits keeps 15 and no float noise", () => {
		expect(toFloat(dec("0.1").plus("0.2"), 15)).toBe(0.3);
		expect(toFloat(dec("1544.9999999999999999"), 15)).toBe(1545);
		expect(toFloat(dec("10.3"), 15)).toBe(10.3);
	});

	it("number wrappers follow the same rule", () => {
		expect(computeAmountInUSD(28.5, "ARS", 100)).toBe(0.28); // 0.285, 28 even
		expect(computeAmountInUSD(0.5, "ARS", 100)).toBe(0); // 0.5 cents, 0 even
		expect(toMinorUnits(-0.015, "USD")).toBe(-2); // -1.5 cents, magnitude 2
		expect(Object.is(toMinorUnits(-0.005, "USD"), 0)).toBe(true); // never -0
		expect(roundMoney(0.285, "USD")).toBe(0.28);
		expect(toAmountString(0.285, "USD")).toBe("0.28");
		expect(toAmountString(1.2345, "KWD")).toBe("1.234");
		// 4.5 / 3 x 1 = 1.5 JPY, rounded to 2.
		expect(roundMoney(convertAmount(4.5, "EUR", 3, "JPY", 1), "JPY")).toBe(2);
	});

	it("a negative that rounds to zero is 0, never -0", () => {
		// -0.004 USD is -0.4 cents: rounds to 0, which must not keep its sign.
		expect(Object.is(roundMoney(-0.004, "USD"), 0)).toBe(true);
		// -0.4 ARS / 100 = -0.004 USD: the stored value is 0, not -0.
		expect(Object.is(computeAmountInUSD(-0.4, "ARS", 100), 0)).toBe(true);
		// -0.4 JPY is 0 yen; -0.000000004 BTC is 0 satoshis.
		expect(Object.is(roundMoney(-0.4, "JPY"), 0)).toBe(true);
		expect(toAmountString(-0.000000004, "BTC")).toBe("0");
		for (const d of [
			roundUSDDec("-0.004"),
			roundMoneyDec("-0.4", "JPY"),
			roundMoneyDec("-0.0004", "KWD"),
			roundRateDec("-0.0000004", 6),
			computeAmountInUSDDec("-0.4", "ARS", 100),
		])
			expect(d.isNegative(), d.toString()).toBe(false);
	});
});

describe("columnFromFloat", () => {
	it("trims float noise and rounds half to even at the column's scale", () => {
		// 8 dp: ...785 is a tie after an even 8; ...795 a tie after an odd 9.
		expect(columnFromFloat(0.123456785, 8)).toBe("0.12345678");
		expect(columnFromFloat(0.123456795, 8)).toBe("0.1234568");
		// 6 dp, ARS per USD: ...4565 ties down to the even 6, ...4575 up to 8.
		expect(columnFromFloat(1450.1234565, 6)).toBe("1450.123456");
		expect(columnFromFloat(1450.1234575, 6)).toBe("1450.123458");
		// 4 dp, a percentage: 33.33335 ties up to the even 4.
		expect(columnFromFloat(33.33335, 4)).toBe("33.3334");
		// 0.1 + 0.2 is 0.30000000000000004: the noise goes, no tie to break.
		expect(columnFromFloat(0.1 + 0.2, 8)).toBe("0.3");
		// Magnitude rounds, so a negative ties the same way.
		expect(columnFromFloat(-0.123456785, 8)).toBe("-0.12345678");
	});
});

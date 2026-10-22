import { describe, expect, it } from "vitest";
import {
	amountIn,
	computeAmountInUSD,
	convertAmount,
	crossRate,
	currencyDecimals,
	fromMinorUnits,
	fromUSD,
	MissingRateError,
	periodRateDate,
	pickBestRate,
	quoteRate,
	rateFromQuote,
	rateFromUsdPerUnit,
	roundMoney,
	sumIn,
	toAmountString,
	toMinorUnits,
	toUSD,
	tryConvertAmount,
} from "./money";

// Stored rates: fiat = units per USD, crypto = USD per coin.
const RATES: Record<string, number> = {
	USD: 1,
	ARS: 1560,
	BRL: 5.1178,
	EUR: 0.8787,
	JPY: 163.83,
	KWD: 0.3102,
	BTC: 64545.9,
	ETH: 1916.61,
};

describe("toUSD / fromUSD", () => {
	it("divides fiat by units-per-USD", () => {
		expect(toUSD(1560, "ARS", RATES.ARS)).toBeCloseTo(1, 10);
		expect(toUSD(100, "EUR", RATES.EUR)).toBeCloseTo(113.8045, 3);
	});

	it("multiplies crypto by USD-per-coin", () => {
		expect(toUSD(0.5, "BTC", RATES.BTC)).toBeCloseTo(32272.95, 6);
		expect(fromUSD(32272.95, "BTC", RATES.BTC)).toBeCloseTo(0.5, 10);
	});

	it("USD needs no rate", () => {
		expect(toUSD(42, "USD", undefined)).toBe(42);
		expect(fromUSD(42, "USD", null)).toBe(42);
	});

	it("never treats a missing rate as 1", () => {
		expect(() => toUSD(100, "ARS", undefined)).toThrow(MissingRateError);
		expect(() => toUSD(100, "ARS", 0)).toThrow(MissingRateError);
		expect(() => fromUSD(100, "BTC", Number.NaN)).toThrow(MissingRateError);
	});

	it("decides crypto by currency, not by an ARS 'crypto' rate type", () => {
		// ARS has a "crypto" rate type, but it is still ARS per USD.
		expect(computeAmountInUSD(159468, "ARS", 1594.68)).toBe(100);
	});
});

describe("convertAmount and crossRate for any home currency", () => {
	const homes = ["USD", "ARS", "BRL", "EUR", "JPY", "BTC", "ETH"];

	it("round-trips every pair", () => {
		for (const from of homes) {
			for (const to of homes) {
				const there = convertAmount(123.45, from, RATES[from], to, RATES[to]);
				const back = convertAmount(there, to, RATES[to], from, RATES[from]);
				expect(back).toBeCloseTo(123.45, 6);
			}
		}
	});

	it("100 EUR is about 177,535 ARS", () => {
		expect(convertAmount(100, "EUR", RATES.EUR, "ARS", RATES.ARS)).toBeCloseTo(
			177535.0, 0,
		);
	});

	it("1 BTC in ARS and in ETH", () => {
		expect(crossRate("BTC", RATES.BTC, "ARS", RATES.ARS)).toBeCloseTo(
			64545.9 * 1560, 4,
		);
		expect(crossRate("BTC", RATES.BTC, "ETH", RATES.ETH)).toBeCloseTo(
			64545.9 / 1916.61, 8,
		);
	});
});

describe("quoteRate / rateFromQuote", () => {
	it("orients quotes so the number is at least 1", () => {
		const arsInUsd = quoteRate("ARS", RATES.ARS, "USD", 1);
		expect(arsInUsd).toMatchObject({ base: "USD", quote: "ARS" });
		expect(arsInUsd.value).toBeCloseTo(1560, 8);
		const eurInArs = quoteRate("EUR", RATES.EUR, "ARS", RATES.ARS);
		expect(eurInArs.base).toBe("EUR");
		expect(eurInArs.value).toBeCloseTo(1775.35, 1);
		const usdInBtcHome = quoteRate("USD", 1, "BTC", RATES.BTC);
		expect(usdInBtcHome).toMatchObject({ base: "BTC", quote: "USD" });
		expect(usdInBtcHome.value).toBeCloseTo(64545.9, 6);
	});

	it("inverts back to the stored rate for every home", () => {
		const homes = ["USD", "ARS", "BRL", "JPY", "BTC"];
		const foreigns = ["EUR", "ARS", "JPY", "KWD", "BTC", "ETH"];
		for (const home of homes) {
			for (const foreign of foreigns) {
				if (foreign === home) continue;
				const q = quoteRate(foreign, RATES[foreign], home, RATES[home]);
				const stored = rateFromQuote(q, foreign, home, RATES[home]);
				expect(stored / RATES[foreign]!).toBeCloseTo(1, 10);
			}
		}
	});

	it("rateFromUsdPerUnit is the inverse of the convention", () => {
		expect(rateFromUsdPerUnit("ARS", 1 / 1560)).toBeCloseTo(1560, 8);
		expect(rateFromUsdPerUnit("BTC", 64545.9)).toBe(64545.9);
	});
});

describe("decimals", () => {
	it("uses ISO minor units and 8 for crypto", () => {
		expect(currencyDecimals("USD")).toBe(2);
		expect(currencyDecimals("ARS")).toBe(2);
		expect(currencyDecimals("JPY")).toBe(0);
		expect(currencyDecimals("KWD")).toBe(3);
		expect(currencyDecimals("BHD")).toBe(3);
		expect(currencyDecimals("BTC")).toBe(8);
		expect(currencyDecimals("ETH")).toBe(8);
		expect(currencyDecimals("USDT")).toBe(2);
	});

	it("converts to and from minor units without float noise", () => {
		expect(toMinorUnits(1.005, "USD")).toBe(101);
		expect(toMinorUnits(0.003, "BTC")).toBe(300000);
		expect(fromMinorUnits(100000, "BTC")).toBe(0.001);
		expect(toMinorUnits(1.2345, "KWD")).toBe(1235);
		expect(roundMoney(1234.6, "JPY")).toBe(1235);
	});
});

describe("pickBestRate", () => {
	const d = (s: string) => new Date(`${s}T00:00:00Z`);

	it("prefers blue, then official, then crypto", () => {
		const rows = [
			{ type: "official", rate: 1495, date: d("2026-07-29") },
			{ type: "crypto", rate: 1594, date: d("2026-07-29") },
			{ type: "blue", rate: 1560, date: d("2026-07-29") },
		];
		expect(pickBestRate(rows, { date: d("2026-08-01") })?.type).toBe("blue");
		expect(
			pickBestRate(rows.filter((r) => r.type !== "blue"), {
				date: d("2026-08-01"),
			})?.type,
		).toBe("official");
	});

	it("uses a preferred type when present", () => {
		const rows = [
			{ type: "official", rate: 1495, date: d("2026-07-29") },
			{ type: "blue", rate: 1560, date: d("2026-07-29") },
		];
		expect(
			pickBestRate(rows, { date: d("2026-08-01"), preferredType: "official" })
				?.rate,
		).toBe(1495);
		expect(
			pickBestRate(rows, { date: d("2026-08-01"), preferredType: "custom" })
				?.rate,
		).toBe(1560);
	});

	it("takes the latest rate on or before the date", () => {
		const rows = [
			{ type: "official", rate: 1000, date: d("2026-01-01") },
			{ type: "official", rate: 1200, date: d("2026-03-01") },
			{ type: "official", rate: 1500, date: d("2026-07-01") },
		];
		const picked = pickBestRate(rows, { date: d("2026-04-15") });
		expect(picked?.rate).toBe(1200);
		expect(picked?.onOrBefore).toBe(true);
	});

	it("falls back to the nearest later rate instead of 1", () => {
		const rows = [
			{ type: "official", rate: 1500, date: d("2026-07-29") },
			{ type: "official", rate: 1600, date: d("2026-09-01") },
		];
		const picked = pickBestRate(rows, { date: d("2025-12-01") });
		expect(picked?.rate).toBe(1500);
		expect(picked?.onOrBefore).toBe(false);
	});

	it("returns null when there are no usable rows", () => {
		expect(pickBestRate([], { date: d("2026-01-01") })).toBeNull();
		expect(
			pickBestRate([{ type: "official", rate: 0, date: d("2026-01-01") }]),
		).toBeNull();
	});
});

describe("totals rule (sumIn)", () => {
	const items = [
		// 100000 ARS logged at 1000 ARS/USD: stored 100 USD
		{ amount: 100000, currency: "ARS", amountInUSD: 100 },
		{ amount: 20, currency: "USD", amountInUSD: 20 },
		{ amount: 10, currency: "EUR", amountInUSD: 11.38 },
		{ amount: 0.001, currency: "BTC", amountInUSD: 64.55 },
	];

	it("ARS home: ARS as entered, the rest from USD at the home rate", () => {
		expect(sumIn(items, "ARS", RATES.ARS)).toBeCloseTo(
			100000 + (20 + 11.38 + 64.55) * 1560,
			6,
		);
	});

	it("USD home: USD as entered, the rest from their stored USD", () => {
		expect(sumIn(items, "USD", 1)).toBeCloseTo(100 + 20 + 11.38 + 64.55, 6);
	});

	it("EUR, JPY and BRL homes use their own rate", () => {
		expect(sumIn(items, "EUR", RATES.EUR)).toBeCloseTo(
			10 + (100 + 20 + 64.55) * 0.8787,
			6,
		);
		expect(sumIn(items, "JPY", RATES.JPY)).toBeCloseTo(
			(100 + 20 + 11.38 + 64.55) * 163.83,
			6,
		);
		expect(sumIn(items, "BRL", RATES.BRL)).toBeCloseTo(
			(100 + 20 + 11.38 + 64.55) * 5.1178,
			6,
		);
	});

	it("crypto home divides by the coin price", () => {
		expect(sumIn(items, "BTC", RATES.BTC)).toBeCloseTo(
			0.001 + (100 + 20 + 11.38) / 64545.9,
			12,
		);
	});

	it("a missing rate throws only when something needs converting", () => {
		expect(() => sumIn(items, "ARS", undefined)).toThrow(MissingRateError);
		expect(sumIn([items[0]!], "ARS", undefined)).toBe(100000);
		expect(amountIn(items[1]!, "USD", null)).toBe(20);
	});

	it("periodRateDate is the period end, or now while it runs", () => {
		const now = new Date("2026-10-21T12:00:00Z");
		const pastEnd = new Date("2026-09-30T23:59:59Z");
		const futureEnd = new Date("2026-10-31T23:59:59Z");
		expect(periodRateDate(pastEnd, now)).toBe(pastEnd);
		expect(periodRateDate(futureEnd, now)).toBe(now);
	});
});

describe("tryConvertAmount", () => {
	it("returns null for a missing rate, never 0 or the raw amount", () => {
		expect(tryConvertAmount(100, "ARS", undefined, "USD", 1)).toBeNull();
		expect(tryConvertAmount(100, "USD", 1, "EUR", 0)).toBeNull();
	});

	it("converts when both rates are known", () => {
		expect(tryConvertAmount(3000, "ARS", 1500, "USD", 1)).toBe(2);
		expect(tryConvertAmount(5, "EUR", undefined, "EUR", undefined)).toBe(5);
	});
});

describe("toAmountString", () => {
	it("uses ISO minor units for fiat", () => {
		expect(toAmountString(12.5, "USD")).toBe("12.50");
		expect(toAmountString(1200.4, "JPY")).toBe("1200");
		expect(toAmountString(5000, "CLP")).toBe("5000");
		expect(toAmountString(1.25, "KWD")).toBe("1.250");
	});

	it("keeps crypto precision and drops trailing zeros", () => {
		expect(toAmountString(0.004, "ETH")).toBe("0.004");
		expect(toAmountString(0.000123456789, "BTC")).toBe("0.00012346");
		expect(toAmountString(100, "BTC")).toBe("100");
		expect(toAmountString(10, "USDT")).toBe("10");
	});
});

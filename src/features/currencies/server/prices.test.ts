import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { columnsOf, priceAll, toMoney, toRate, fromMinorDec, Dec } =
	await import("./prices");

const r = (currency: string, type: string, rate: string) => ({
	currency,
	type,
	rate,
});

// Units per USD (a coin: USD per coin), as the rate table stores them.
const ROWS = [
	r("ARS", "official", "1412"),
	r("ARS", "blue", "1468"),
	r("ARS", "card", "1836"),
	r("EUR", "official", "0.8"),
	r("BRL", "official", "3"),
	r("BTC", "crypto", "67000"),
];

const minorOf = (home: string) => {
	const priced = priceAll(ROWS, home);
	return Object.fromEntries(
		priced.map((p) => [
			p.code,
			Object.fromEntries(
				[...p.prices].map(([t, v]) => [t, toMoney(v, home).minor]),
			),
		]),
	);
};

describe("priceAll", () => {
	it("prices each currency in ARS per type, each side falling back to its default", () => {
		expect(minorOf("ARS")).toEqual({
			// 1 USD is the ARS rate itself.
			USD: { official: 141200, blue: 146800, card: 183600 },
			// 1412 / 0.8 = 1765, 1468 / 0.8 = 1835, 1836 / 0.8 = 2295
			EUR: { official: 176500, blue: 183500, card: 229500 },
			// 1468 / 3 = 489.333 -> 489.33 (half to even at cents)
			BRL: { official: 47067, blue: 48933, card: 61200 },
			// 67,000 USD at the ARS default (blue): 98,356,000
			BTC: { market: 9835600000 },
		});
	});

	it("marks a price derived when either side lacks that type", () => {
		const derived = Object.fromEntries(
			priceAll(ROWS, "ARS").map((p) => [p.code, [...p.derived]]),
		);
		// USD is the table's base: every ARS type is a real USD rate.
		expect(derived.USD).toEqual([]);
		// BRL has only official: blue and card go through its official rate.
		expect(derived.BRL).toEqual(["blue", "card"]);
		expect(derived.BTC).toEqual([]);
		// UYU has only mep and ARS has no mep: every price is derived, mep
		// through the home's default (blue): 1468 / 40 = 36.70.
		const uyu = priceAll([...ROWS, r("UYU", "mep", "40")], "ARS").find(
			(p) => p.code === "UYU",
		);
		expect([...(uyu?.derived ?? [])]).toEqual([
			"official",
			"blue",
			"card",
			"mep",
		]);
		const mep = uyu?.prices.get("mep");
		expect(mep && toMoney(mep, "ARS").minor).toBe(3670);
	});

	it("a currency with no rate of any type is never priced", () => {
		const priced = priceAll(ROWS, "ARS");
		expect(priced.find((p) => p.code === "GBP")).toBeUndefined();
		// No ARS rate at all: nothing is derived through it.
		expect(priceAll([r("BRL", "official", "3")], "ARS")).toEqual([]);
	});

	it("orders the columns, coins last", () => {
		expect(columnsOf(priceAll(ROWS, "ARS"))).toEqual([
			"official",
			"blue",
			"card",
			"market",
		]);
	});

	it("with a USD home, a fiat has only its own types", () => {
		const usd = minorOf("USD");
		expect(usd.EUR).toEqual({ official: 125 });
		expect(usd.BTC).toEqual({ market: 6700000 });
		// 1 ARS is under a cent: it rounds to 0.00 (GAPS: rate formatter).
		expect(usd.ARS?.official).toBe(0);
	});

	it("a home with no rate prices nothing (never 1)", () => {
		expect(priceAll(ROWS, "CLP")).toEqual([]);
	});

	it("skips zero and broken rates", () => {
		const priced = priceAll([...ROWS, r("UYU", "official", "0")], "ARS");
		expect(priced.find((p) => p.code === "UYU")).toBeUndefined();
	});
});

/** What the page shows: units of the currency per 1 home unit, as { minor, places }. */
const perHomeOf = (home: string) =>
	Object.fromEntries(
		priceAll(ROWS, home).map((p) => [
			p.code,
			Object.fromEntries(
				[...p.perHome].map(([t, v]) => {
					const rate = toRate(v, p.code);
					return [t, [rate.minor, rate.places]];
				}),
			),
		]),
	);

describe("perHome (1 home unit in the row's currency)", () => {
	it("ARS home: 1 ARS buys a fraction of a dollar, each type its own", () => {
		expect(perHomeOf("ARS")).toEqual({
			// 1 / 1412 = 0.000708 -> 0.00071; 1 / 1468 = 0.000681 -> 0.00068;
			// 1 / 1836 = 0.000545 -> 0.00054 (5 places)
			USD: { official: [71, 5], blue: [68, 5], card: [54, 5] },
			// 0.8 / 1412 = 0.000567 -> 0.00057; 0.8 / 1468 = 0.000545 -> 0.00054;
			// 0.8 / 1836 = 0.000436 -> 0.00044
			EUR: { official: [57, 5], blue: [54, 5], card: [44, 5] },
			// 3 / 1412 = 0.002125 -> 0.0021; 3 / 1468 = 0.002044 -> 0.0020;
			// 3 / 1836 = 0.001634 -> 0.0016 (4 places)
			BRL: { official: [21, 4], blue: [20, 4], card: [16, 4] },
			// 1 / (67000 x 1468) = 1.0167e-8: one satoshi at 8 places.
			BTC: { market: [1, 8] },
		});
	});

	it("USD home: 1 USD is the rate itself, a coin is 1 / its price", () => {
		expect(perHomeOf("USD")).toMatchObject({
			ARS: { official: [141200, 2], blue: [146800, 2], card: [183600, 2] },
			EUR: { official: [80, 2] },
			BRL: { official: [300, 2] },
			// 1 / 67000 = 0.0000149254 -> 1493 at 8 places.
			BTC: { market: [1493, 8] },
		});
	});
});

describe("toRate", () => {
	it("extends the currency's digits until two significant digits show", () => {
		expect(toRate(new Dec("0.000643"), "USD")).toEqual({
			minor: 64,
			currency: "USD",
			places: 5,
		});
		expect(toRate(new Dec("0.307"), "KWD")).toEqual({
			minor: 307,
			currency: "KWD",
			places: 3,
		});
		expect(toRate(new Dec("1555"), "ARS")).toEqual({
			minor: 155500,
			currency: "ARS",
			places: 2,
		});
		// A whole-unit currency starts at 0 places: 150.4 -> 150.
		expect(toRate(new Dec("150.4"), "JPY")).toEqual({
			minor: 150,
			currency: "JPY",
			places: 0,
		});
	});

	it("stops at six extra places for a fiat, eight for a coin", () => {
		// 1e-9 USD never shows two digits: it stops at 2 + 6 places and reads 0.
		expect(toRate(new Dec("0.000000001"), "USD")).toEqual({
			minor: 0,
			currency: "USD",
			places: 8,
		});
		expect(toRate(new Dec("0.0000089"), "BTC")).toEqual({
			minor: 890,
			currency: "BTC",
			places: 8,
		});
	});

	it("rounds half to even at the last place", () => {
		// 0.0000125 at 6 places is 12.5 -> 12 (even); 0.0000135 is 13.5 -> 14.
		expect(toRate(new Dec("0.0000125"), "USD").minor).toBe(12);
		expect(toRate(new Dec("0.0000135"), "USD").minor).toBe(14);
	});
});

describe("toMoney / fromMinorDec", () => {
	it("round half to even at the currency's minor unit", () => {
		// 10.05 / 10 = 1.005: half to even keeps 1.00 (half up would say 1.01).
		expect(toMoney(fromMinorDec(1005, "USD").div(10), "USD").minor).toBe(100);
		expect(toMoney(fromMinorDec(400000, "ETH"), "ETH")).toEqual({
			minor: 400000,
			currency: "ETH",
		});
	});
});

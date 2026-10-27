import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildCurrenciesView, convert } = await import("./view-model");

const r = (currency: string, type: string, rate: string) => ({
	id: `${currency}_${type}`,
	currency,
	type,
	rate,
});

const RATES = [
	r("ARS", "official", "1412"),
	r("ARS", "blue", "1468"),
	r("BRL", "official", "3"),
	r("BTC", "crypto", "67000"),
];

describe("buildCurrenciesView", () => {
	const view = buildCurrenciesView({
		home: "ARS",
		rates: RATES,
		favorites: [{ id: "BRL_official", currency: "BRL" }],
		accounts: [
			{ name: "Chile savings", currency: "CLP" },
			{ name: "Wise", currency: "USD" },
		],
		updated: "2026-10-21",
	});

	it("favorites first, then priced, then missing", () => {
		expect(view.rows.map((x) => x.code)).toEqual(["BRL", "BTC", "USD", "CLP"]);
	});

	it("the default type is the built-in one until the seam is replaced", () => {
		expect(view.homeDefault).toBe("blue");
		expect(view.canSetDefault).toBe(false);
		const usd = view.rows.find((x) => x.code === "USD");
		expect(usd?.defaultType).toBe("blue");
		// The stronger one is the unit: 1 USD = ARS 1,468.
		expect(usd?.prices.blue).toEqual({
			minor: 146800,
			currency: "ARS",
			places: 2,
			base: "USD",
		});
		expect(usd?.rateId).toBeNull();
		expect(usd?.usedBy).toEqual(["Wise"]);
	});

	it("a currency with no rate is a row with no prices, naming its accounts", () => {
		const clp = view.rows.find((x) => x.code === "CLP");
		expect(clp).toMatchObject({
			types: [],
			prices: {},
			usedBy: ["Chile savings"],
		});
	});

	it("names the prices derived through another type's rate", () => {
		const brl = view.rows.find((x) => x.code === "BRL");
		// BRL has only official: its blue price is ARS blue over BRL official.
		expect(brl?.derived).toEqual(["blue"]);
		expect(view.rows.find((x) => x.code === "USD")?.derived).toEqual([]);
	});

	it("unfavoriting removes every favorite row of the currency", () => {
		const brl = view.rows.find((x) => x.code === "BRL");
		expect(brl).toMatchObject({
			favorite: true,
			favoriteIds: ["BRL_official"],
		});
		expect(brl?.rateId).toBe("BRL_official");
	});
});

describe("convert", () => {
	it("USD 100 into ARS at each type", () => {
		expect(convert(RATES, "ARS", "USD", 10000, "toHome")).toEqual([
			{
				type: "official",
				value: { minor: 14120000, currency: "ARS" },
				derived: false,
			},
			{
				type: "blue",
				value: { minor: 14680000, currency: "ARS" },
				derived: false,
			},
		]);
	});

	it("ARS 1,000 into BRL: 1000 / (1468 / 3) = 2.0436 -> BRL 2.04 at blue", () => {
		const out = convert(RATES, "ARS", "BRL", 100000, "fromHome");
		expect(out.find((x) => x.type === "blue")).toEqual({
			type: "blue",
			value: { minor: 204, currency: "BRL" },
			derived: true,
		});
	});

	it("an unknown currency converts to nothing", () => {
		expect(convert(RATES, "ARS", "CLP", 100, "toHome")).toEqual([]);
	});
});

describe("each row prices the stronger currency in the weaker", () => {
	const view = (home: string, rates: ReturnType<typeof r>[]) =>
		buildCurrenciesView({
			home,
			rates,
			favorites: [],
			accounts: [],
			updated: null,
		});
	const price = (v: ReturnType<typeof view>, code: string, type: string) =>
		v.rows.find((x) => x.code === code)?.prices[type];

	it("USD home: 1 USD = ARS 1,555 and BRL 5.40; 1 KWD = USD 3.26; 1 BTC = USD 112,000", () => {
		const v = view("USD", [
			r("ARS", "official", "1400"),
			r("ARS", "blue", "1555"),
			r("BRL", "official", "5.4"),
			r("KWD", "official", "0.307"),
			r("BTC", "crypto", "112000"),
		]);
		expect(price(v, "ARS", "blue")).toEqual({
			minor: 155500,
			currency: "ARS",
			places: 2,
			base: "USD",
		});
		expect(price(v, "ARS", "official")).toEqual({
			minor: 140000,
			currency: "ARS",
			places: 2,
			base: "USD",
		});
		expect(price(v, "BRL", "official")).toEqual({
			minor: 540,
			currency: "BRL",
			places: 2,
			base: "USD",
		});
		// 1 / 0.307 = 3.2573: KWD is stronger, so 1 KWD = USD 3.26.
		expect(price(v, "KWD", "official")).toEqual({
			minor: 326,
			currency: "USD",
			places: 2,
			base: "KWD",
		});
		expect(price(v, "BTC", "market")).toEqual({
			minor: 11200000,
			currency: "USD",
			places: 2,
			base: "BTC",
		});
		// The units differ (USD, KWD, BTC), so each cell names its own.
		expect(v.base).toBeNull();
	});

	it("ARS home: 1 USD = ARS 1,450, 1 BRL = ARS 268.52, 1 EUR = ARS 1,611.11", () => {
		const v = view("ARS", [
			r("ARS", "official", "1450"),
			r("BRL", "official", "5.4"),
			r("EUR", "official", "0.9"),
		]);
		expect(price(v, "USD", "official")).toEqual({
			minor: 145000,
			currency: "ARS",
			places: 2,
			base: "USD",
		});
		// 1450 / 5.4 = 268.5185 -> 268.52
		expect(price(v, "BRL", "official")).toEqual({
			minor: 26852,
			currency: "ARS",
			places: 2,
			base: "BRL",
		});
		// 1450 / 0.9 = 1611.111 -> 1611.11
		expect(price(v, "EUR", "official")).toEqual({
			minor: 161111,
			currency: "ARS",
			places: 2,
			base: "EUR",
		});
	});

	it("a home weaker than the dollar still prices the dollar as the unit", () => {
		// IDR home, 15,000 per USD: 1 USD = IDR 15,000.
		const idr = view("IDR", [r("IDR", "official", "15000")]);
		expect(price(idr, "USD", "official")).toMatchObject({
			minor: 1500000,
			currency: "IDR",
			base: "USD",
		});
	});

	it("when every price shares one unit the page names it once", () => {
		const v = view("USD", [
			r("ARS", "official", "1400"),
			r("BRL", "official", "5.4"),
		]);
		expect(v.base).toBe("USD");
	});

	it("a currency with no rate has no price (never 1)", () => {
		const v = view("USD", [r("ARS", "official", "1400")]);
		expect(price(v, "EUR", "official")).toBeUndefined();
	});
});

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
		// 1 ARS buys 1 / 1468 = 0.00068 USD (two significant digits, 5 places).
		expect(usd?.prices.blue).toEqual({
			minor: 68,
			currency: "USD",
			places: 5,
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

describe("each row reads 1 home unit in the row's currency", () => {
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

	it("USD home: 1 USD = ARS 1,555 at blue, BRL 5.35, KWD 0.307, BTC 0.00000893", () => {
		const v = view("USD", [
			r("ARS", "official", "1400"),
			r("ARS", "blue", "1555"),
			r("BRL", "official", "5.35"),
			r("KWD", "official", "0.307"),
			r("BTC", "crypto", "112000"),
		]);
		expect(price(v, "ARS", "blue")).toEqual({
			minor: 155500,
			currency: "ARS",
			places: 2,
		});
		expect(price(v, "ARS", "official")).toEqual({
			minor: 140000,
			currency: "ARS",
			places: 2,
		});
		expect(price(v, "BRL", "official")).toEqual({
			minor: 535,
			currency: "BRL",
			places: 2,
		});
		// KWD keeps its three digits.
		expect(price(v, "KWD", "official")).toEqual({
			minor: 307,
			currency: "KWD",
			places: 3,
		});
		// 1 / 112000 = 0.00000892857: eight places, half to even -> 893.
		expect(price(v, "BTC", "market")).toEqual({
			minor: 893,
			currency: "BTC",
			places: 8,
		});
	});

	it("ARS home: 1 ARS = USD 0.00064 at blue; BRL goes through the dollar", () => {
		const v = view("ARS", [
			r("ARS", "official", "1400"),
			r("ARS", "blue", "1555"),
			r("BRL", "official", "5"),
		]);
		// 1 / 1555 = 0.000643: two significant digits need 5 places.
		expect(price(v, "USD", "blue")).toEqual({
			minor: 64,
			currency: "USD",
			places: 5,
		});
		// 5 / 1555 = 0.00321543 -> 0.0032 (4 places); at official 5 / 1400 = 0.00357 -> 0.0036.
		expect(price(v, "BRL", "blue")).toEqual({
			minor: 32,
			currency: "BRL",
			places: 4,
		});
		expect(price(v, "BRL", "official")).toEqual({
			minor: 36,
			currency: "BRL",
			places: 4,
		});
	});

	it("a currency with no rate has no price (never 1)", () => {
		const v = view("USD", [r("ARS", "official", "1400")]);
		expect(price(v, "EUR", "official")).toBeUndefined();
	});
});

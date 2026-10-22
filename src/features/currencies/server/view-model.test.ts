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
		expect(usd?.prices.blue).toEqual({ minor: 146800, currency: "ARS" });
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
			{ type: "official", value: { minor: 14120000, currency: "ARS" } },
			{ type: "blue", value: { minor: 14680000, currency: "ARS" } },
		]);
	});

	it("ARS 1,000 into BRL: 1000 / (1468 / 3) = 2.0436 -> BRL 2.04 at blue", () => {
		const out = convert(RATES, "ARS", "BRL", 100000, "fromHome");
		expect(out.find((x) => x.type === "blue")?.value).toEqual({
			minor: 204,
			currency: "BRL",
		});
	});

	it("an unknown currency converts to nothing", () => {
		expect(convert(RATES, "ARS", "CLP", 100, "toHome")).toEqual([]);
	});
});

import {
	type CurrencyRow,
	defaultPrice,
	missingRows,
	pinChange,
	rateTypeKey,
	readConvQuery,
	visibleRows,
} from "./source";

const price = (
	minor: number,
	currency: string,
	places: number,
	base: string,
) => ({
	minor,
	currency,
	places,
	base,
});

function row(code: string, extra: Partial<CurrencyRow> = {}): CurrencyRow {
	return {
		code,
		crypto: false,
		rates: [
			{
				type: "official",
				price: price(141200, "ARS", 2, code),
				derived: false,
			},
			{ type: "blue", price: price(146800, "ARS", 2, code), derived: false },
		],
		defaultType: "blue",
		favorite: false,
		rateId: `${code}_blue`,
		favoriteIds: [],
		usedBy: [],
		...extra,
	};
}

const usd = row("USD", { favorite: true, favoriteIds: ["USD_blue"] });
const brl = row("BRL");
const btc = row("BTC", {
	crypto: true,
	rates: [
		{
			type: "market",
			price: price(9460000000, "ARS", 2, "BTC"),
			derived: false,
		},
	],
	defaultType: "market",
});
const clp = row("CLP", {
	rates: [],
	defaultType: null,
	rateId: null,
	usedBy: ["Chile savings"],
});
const rows = [usd, brl, btc, clp];
const name = (code: string) =>
	({
		USD: "US Dollar",
		BRL: "Real brasileño",
		BTC: "Bitcoin",
		CLP: "Chilean Peso",
	})[code] ?? code;

describe("visibleRows", () => {
	it("keeps the server's order and filters by kind and favorites", () => {
		expect(visibleRows(rows, "all", "", name, null).map((r) => r.code)).toEqual(
			["USD", "BRL", "BTC", "CLP"],
		);
		expect(visibleRows(rows, "favorites", "", name, null)).toEqual([usd]);
		expect(visibleRows(rows, "crypto", "", name, null)).toEqual([btc]);
		expect(visibleRows(rows, "fiat", "", name, null)).not.toContain(btc);
	});

	it("matches the code or the name, ignoring case and accents", () => {
		expect(visibleRows(rows, "all", "brasileno", name, null)).toEqual([brl]);
		expect(visibleRows(rows, "all", " btc ", name, null)).toEqual([btc]);
	});

	it("shows only a conversion's currency", () => {
		const conv = readConvQuery("100 brl", "ARS", rows, "en-US");
		expect(visibleRows(rows, "all", "100 brl", name, conv)).toEqual([brl]);
	});
});

describe("readConvQuery", () => {
	it("reads an amount and a code into home", () => {
		expect(readConvQuery("100 usd", "ARS", rows, "en-US")).toEqual({
			code: "USD",
			from: "USD",
			to: "ARS",
			minor: 10000,
			direction: "toHome",
		});
	});

	it("reads home into another currency in the locale's separators", () => {
		expect(readConvQuery("50.000,5 ars a brl", "ARS", rows, "es-AR")).toEqual({
			code: "BRL",
			from: "ARS",
			to: "BRL",
			minor: 5000050,
			direction: "fromHome",
		});
	});

	it("is a plain search for anything else", () => {
		expect(readConvQuery("usd", "ARS", rows, "en-US")).toBeNull();
		// Neither side is home.
		expect(readConvQuery("100 usd to brl", "ARS", rows, "en-US")).toBeNull();
		// No rate to convert at: never a 1.
		expect(readConvQuery("100 clp", "ARS", rows, "en-US")).toBeNull();
		expect(readConvQuery("100 ars", "ARS", rows, "en-US")).toBeNull();
	});
});

describe("prices", () => {
	it("takes the default type's price, or none without a rate", () => {
		expect(defaultPrice(usd)).toEqual(price(146800, "ARS", 2, "USD"));
		expect(defaultPrice(clp)).toBeNull();
	});

	it("names only currencies an open account uses as missing", () => {
		expect(missingRows(rows)).toEqual([clp]);
		expect(missingRows([row("CLP", { rates: [], usedBy: [] })])).toEqual([]);
	});
});

describe("pinChange", () => {
	it("pins the default rate, or removes every pin", () => {
		expect(pinChange(brl, true)).toEqual({ add: ["BRL_blue"], remove: [] });
		expect(pinChange(usd, false)).toEqual({ add: [], remove: ["USD_blue"] });
		expect(pinChange(row("EUR", { rateId: null }), true)).toEqual({
			add: [],
			remove: [],
		});
	});
});

it("knows the app's rate types and leaves others unnamed", () => {
	expect(rateTypeKey("mep")).toBe("mep");
	expect(rateTypeKey("parallel")).toBeNull();
});

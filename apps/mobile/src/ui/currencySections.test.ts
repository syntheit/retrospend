import { currencySections, isCrypto, mergeRecent } from "./currencySections";

// The picker's sections: pins first, then yours, recent, fiat and crypto,
// each code once.
const all = ["USD", "EUR", "ARS", "BRL", "BTC", "ETH", "JPY"];

describe("currencySections", () => {
	it("puts pinned first, then yours, recent, fiat and crypto", () => {
		const s = currencySections({
			currencies: all,
			pinned: ["JPY", "BTC"],
			yours: ["USD", "ARS"],
			recent: ["BRL"],
		});
		expect(s.pinned).toEqual(["JPY", "BTC"]);
		expect(s.yours).toEqual(["USD", "ARS"]);
		expect(s.recent).toEqual(["BRL"]);
		expect(s.fiat).toEqual(["EUR"]);
		expect(s.crypto).toEqual(["ETH"]);
	});

	it("shows a code once, in the first section that has it", () => {
		const s = currencySections({
			currencies: all,
			pinned: ["USD"],
			yours: ["USD", "EUR"],
			recent: ["EUR", "USD", "ETH"],
		});
		expect(s.pinned).toEqual(["USD"]);
		expect(s.yours).toEqual(["EUR"]);
		expect(s.recent).toEqual(["ETH"]);
		const everything = Object.values(s).flat();
		expect(new Set(everything).size).toBe(everything.length);
		expect([...everything].sort()).toEqual([...all].sort());
	});

	it("drops codes the screen cannot choose and keeps the given order", () => {
		const s = currencySections({
			currencies: ["EUR", "USD", "BTC"],
			pinned: ["XYZ", "USD"],
			yours: [],
			recent: [],
		});
		expect(s.pinned).toEqual(["USD"]);
		expect(s.fiat).toEqual(["EUR"]);
		expect(s.crypto).toEqual(["BTC"]);
	});

	it("tells crypto from fiat by the shared currencies table", () => {
		expect(isCrypto("BTC")).toBe(true);
		expect(isCrypto("USD")).toBe(false);
	});
});

describe("mergeRecent", () => {
	it("keeps this phone's picks first and each code once", () => {
		expect(mergeRecent(["ARS", "USD"], ["EUR", "ARS"])).toEqual([
			"ARS",
			"USD",
			"EUR",
		]);
	});
});

import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

const NB = "\u00a0";

describe("formatMoney places (a rate with more digits than the currency)", () => {
	it("shows a sub-cent fiat rate at its own places", () => {
		// 64 at 5 places is 0.00064.
		expect(
			formatMoney({ minor: 64, currency: "USD" }, { locale: "en", places: 5 }),
		).toBe(`USD${NB}0.00064`);
	});

	it("drops trailing zeros beyond the currency's own digits, keeps those it has", () => {
		// 1.50000 at 5 places reads 1.50, not 1.5 and not 1.50000.
		expect(
			formatMoney(
				{ minor: 150000, currency: "USD" },
				{ locale: "en", places: 5 },
			),
		).toBe(`USD${NB}1.50`);
		expect(
			formatMoney(
				{ minor: 123450, currency: "USD" },
				{ locale: "en", places: 5 },
			),
		).toBe(`USD${NB}1.2345`);
	});

	it("is ignored when it is not more than the currency has", () => {
		expect(
			formatMoney(
				{ minor: 155500, currency: "ARS" },
				{ locale: "en", places: 2 },
			),
		).toBe(`ARS${NB}1,555`);
		expect(
			formatMoney({ minor: 307, currency: "KWD" }, { locale: "en", places: 3 }),
		).toBe(`KWD${NB}0.307`);
	});

	it("a coin keeps its significant digits without trailing zeros", () => {
		expect(
			formatMoney(
				{ minor: 1493, currency: "BTC" },
				{ locale: "en", places: 8 },
			),
		).toBe(`BTC${NB}0.00001493`);
	});
});

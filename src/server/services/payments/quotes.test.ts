import { describe, expect, it } from "vitest";
import { balanceParts } from "../people/balances";
import { allocatePayment, toPaymentCurrency } from "./allocate";
import { netInHome } from "./owed";
import { loadQuotes } from "./quotes";

const day = new Date("2026-11-12T00:00:00.000Z");

/** A rate table: per currency, one row of the given type (fiat per USD). */
function rates(table: Record<string, { type: string; rate: number }>) {
	return {
		exchangeRate: {
			findMany: async ({ where }: { where: { currency: string } }) => {
				const row = table[where.currency];
				return row ? [{ ...row, date: day }] : [];
			},
		},
	} as never;
}

describe("loadQuotes", () => {
	it("a rate that is exact stays exact: USD into a home at 7 is 7, not 6.99...98", async () => {
		const quotes = await loadQuotes(
			rates({ JPY: { type: "official", rate: 7 } }),
			{ into: "JPY", currencies: ["USD"], date: day },
		);
		expect(quotes.get("USD")?.perUnit.toFixed()).toBe("7");
	});

	it("a tie at the home currency's minor unit rounds half to even", () => {
		// USD 0.50 (50 minor) at 7 JPY per USD is 3.5 yen: 3 and 4 are the
		// neighbors, so half even gives 4. 7 x 0.5 through 1 / (1 / 7) would
		// be 3.4999...9 and give 3.
		return loadQuotes(rates({ JPY: { type: "official", rate: 7 } }), {
			into: "JPY",
			currencies: ["USD"],
			date: day,
		}).then((quotes) => {
			expect(toPaymentCurrency(50, "USD", "JPY", quotes.get("USD") ?? null)).toBe(4);
			// USD 0.30 at 7 is 2.1 yen: no tie, 2.
			expect(toPaymentCurrency(30, "USD", "JPY", quotes.get("USD") ?? null)).toBe(2);
		});
	});

	it("ARS blue at 1545: USD 10.01 is ARS 15,465.45, and the quote reads 1545", async () => {
		const quotes = await loadQuotes(
			rates({ ARS: { type: "blue", rate: 1545 } }),
			{ into: "ARS", currencies: ["USD"], date: day },
		);
		const quote = quotes.get("USD");
		expect(quote?.perUnit.toFixed()).toBe("1545");
		expect(quote?.rateType).toBe("blue");
		// 10.01 x 1545 = 15465.45 (1001 minor USD to 1546545 minor ARS).
		expect(toPaymentCurrency(1001, "USD", "ARS", quote ?? null)).toBe(1_546_545);
	});

	it("a cross rate divides once: EUR at 0.8 per USD into ARS at 1545 is 1931.25", async () => {
		// 1 EUR = 1 / 0.8 USD = 1.25 USD; 1.25 x 1545 = 1931.25 ARS, exactly.
		const quotes = await loadQuotes(
			rates({
				ARS: { type: "blue", rate: 1545 },
				EUR: { type: "official", rate: 0.8 },
			}),
			{ into: "ARS", currencies: ["EUR"], date: day },
		);
		expect(quotes.get("EUR")?.perUnit.toFixed()).toBe("1931.25");
	});

	it("a currency with no rate gets no quote, never 1", async () => {
		const quotes = await loadQuotes(
			rates({ ARS: { type: "blue", rate: 1545 } }),
			{ into: "ARS", currencies: ["JPY"], date: day },
		);
		expect(quotes.has("JPY")).toBe(false);
	});
});

// NOK at 9 per USD into a JPY home at 16.5: 1 NOK = 16.5 / 9 = 1.8333...3 JPY,
// a quotient that never ends. 3 NOK is 3 x 16.5 / 9 = 5.5 JPY, a tie that half
// even takes to 6 (5 is odd). 3 x the 40-digit quotient is 5.4999...9 and gave 5.
describe("a quote with a non-terminating cross rate", () => {
	const table = {
		NOK: { type: "official", rate: 9 },
		JPY: { type: "official", rate: 16.5 },
	};
	const load = () =>
		loadQuotes(rates(table), { into: "JPY", currencies: ["NOK"], date: day });

	it("converts an amount with one division, so NOK 3.00 is JPY 6", async () => {
		const quote = (await load()).get("NOK") ?? null;
		expect(toPaymentCurrency(300, "NOK", "JPY", quote)).toBe(6);
		// NOK 1.00 is 1.8333 yen: no tie, 2. NOK 9.00 is exactly 16.5: tie, 16.
		expect(toPaymentCurrency(100, "NOK", "JPY", quote)).toBe(2);
		expect(toPaymentCurrency(900, "NOK", "JPY", quote)).toBe(16);
		// The rate it shows is still the quotient.
		expect(quote?.perUnit.toFixed(6)).toBe("1.833333");
	});

	it("the owed figure in home counts NOK 3.00 as JPY 6", async () => {
		const quotes = await load();
		expect(netInHome(new Map([["NOK", 300]]), "JPY", quotes)).toBe(6);
		// Owed back is the same size the other way: -NOK 3.00 is -JPY 6.
		expect(netInHome(new Map([["NOK", -300]]), "JPY", quotes)).toBe(-6);
	});

	it("the People home value of NOK 3.00 is JPY 6", async () => {
		const [part] = balanceParts(new Map([["NOK", 300]]), "JPY", await load());
		expect(part?.home).toEqual({ minor: 6, currency: "JPY" });
		expect(part?.rate?.rate.startsWith("1.8333333")).toBe(true);
	});

	it("settle up: everything owed in NOK 3.00 is JPY 6, and JPY 6 clears it", async () => {
		const lines = [
			{ scope: null, currency: "NOK", owed: 300, oldest: "2026-10-01" },
		];
		const everything = allocatePayment({
			lines,
			currency: "JPY",
			amount: null,
			quotes: await load(),
		});
		expect(everything.full).toBe(6);
		expect(everything.rows.map((r) => [r.currency, r.amount, r.paid])).toEqual([
			["NOK", 300, 6],
		]);
		const paid = allocatePayment({
			lines,
			currency: "JPY",
			amount: 6,
			quotes: await load(),
		});
		expect(paid.rows.map((r) => [r.amount, r.paid])).toEqual([[300, 6]]);
		expect(paid.remainder).toEqual([]);
		expect(paid.overpay).toBe(0);
	});

	it("a part payment converts back with one division: JPY 5 buys NOK 2.73", async () => {
		// 5 x 9 / 16.5 = 2.7272...: NOK 2.73. NOK 0.27 is left.
		const a = allocatePayment({
			lines: [
				{ scope: null, currency: "NOK", owed: 300, oldest: "2026-10-01" },
			],
			currency: "JPY",
			amount: 5,
			quotes: await load(),
		});
		expect(a.rows.map((r) => [r.amount, r.paid])).toEqual([[273, 5]]);
		expect(a.remainder).toEqual([{ scope: null, currency: "NOK", amount: 27 }]);
	});
});

import { describe, expect, it } from "vitest";
import { toPaymentCurrency } from "./allocate";
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

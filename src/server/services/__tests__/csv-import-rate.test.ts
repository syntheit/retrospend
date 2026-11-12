// Expected values are derived by hand in each comment. Rates follow the
// stored convention: fiat in units per USD, crypto in USD per coin.

import { pickBestRate } from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import { resolveImportRate } from "../csv.service";

describe("resolveImportRate (CSV import and import finalize)", () => {
	const none = () => null;
	const date = new Date("2026-08-01");
	const row = (
		amount: number,
		currency: string,
		extra: { exchangeRate?: number; amountInUSD?: number } = {},
	) => ({ title: "x", amount, currency, date, ...extra });

	it("recomputes USD from a crypto rate by multiplying", () => {
		// 0.5 BTC x 60,000 USD per coin = 30,000 USD; the file's USD is ignored.
		expect(
			resolveImportRate(
				row(0.5, "btc", { exchangeRate: 60000, amountInUSD: 0.0000083 }),
				none,
			),
		).toEqual({ exchangeRate: "60000", amountInUSD: "30000.00" });
	});

	it("derives a fiat rate from a USD amount", () => {
		// 1560 ARS for 1 USD: 1560 / 1 = 1560 per USD.
		expect(
			resolveImportRate(row(1560, "ARS", { amountInUSD: 1 }), none),
		).toEqual({ exchangeRate: "1560", amountInUSD: "1.00" });
	});

	it("falls back to the table rate for the row date", () => {
		// 51.178 BRL / 5.1178 = 10 USD.
		const rows = [
			{ type: "official", rate: 5.1178, date: new Date("2026-07-29") },
		];
		expect(
			resolveImportRate(row(51.178, "BRL"), (_c, d) =>
				pickBestRate(rows, { date: d }),
			),
		).toEqual({ exchangeRate: "5.1178", amountInUSD: "10.00" });
	});

	it("throws instead of using rate 1 when nothing is known", () => {
		expect(() => resolveImportRate(row(10, "ARS"), none)).toThrow(
			/Missing exchange rate/,
		);
	});

	describe("ties round half to even", () => {
		it("ARS at the file's rate: 28.5 at 100 per USD is 0.285, so 0.28", () => {
			// 28.5 cents, 8 is even (half up gave 0.29).
			expect(
				resolveImportRate(row(28.5, "ARS", { exchangeRate: 100 }), none),
			).toEqual({ exchangeRate: "100", amountInUSD: "0.28" });
		});

		it("ARS blue from the file's USD: 7 ARS for 0.015 USD stores 0.02", () => {
			// The exact rate is 0.015 / 7 USD per ARS, so the USD value is the
			// file's 0.015: 1.5 cents, 2 is even. The leg 7 / 0.015 = 466.666...
			// is 466.666667 at 6 decimals.
			expect(
				resolveImportRate(row(7, "ARS", { amountInUSD: 0.015 }), none),
			).toEqual({ exchangeRate: "466.666667", amountInUSD: "0.02" });
		});

		it("ARS blue from the table: 15465.45 at 1545 is 10.01 USD", () => {
			// 15465.45 / 1545 = 10.01 exactly (1545 x 10.01 = 15465.45).
			const blue = [{ type: "blue", rate: 1545, date }];
			expect(
				resolveImportRate(row(15465.45, "ARS"), (_c, d) =>
					pickBestRate(blue, { date: d }),
				),
			).toEqual({ exchangeRate: "1545", amountInUSD: "10.01" });
		});

		it("JPY 1257.5 at 50 per USD is 25.15 USD, not a tie; 1252.5 is 25.05", () => {
			// 1257.5 / 50 = 25.15 and 1252.5 / 50 = 25.05: exact at cents.
			expect(
				resolveImportRate(row(1257.5, "JPY", { exchangeRate: 50 }), none)
					.amountInUSD,
			).toBe("25.15");
			expect(
				resolveImportRate(row(1252.5, "JPY", { exchangeRate: 50 }), none)
					.amountInUSD,
			).toBe("25.05");
			// 1 JPY at 200 per USD is 0.005 USD, a tie: 0 is even, so 0.00.
			expect(
				resolveImportRate(row(1, "JPY", { exchangeRate: 200 }), none)
					.amountInUSD,
			).toBe("0.00");
		});

		it("KWD 0.3075 at 0.3 per USD is 1.025 USD, so 1.02", () => {
			// 0.3075 / 0.3 = 1.025: 102.5 cents, 2 is even (half up gave 1.03).
			expect(
				resolveImportRate(row(0.3075, "KWD", { exchangeRate: 0.3 }), none),
			).toEqual({ exchangeRate: "0.3", amountInUSD: "1.02" });
		});

		it("BTC 0.0000005 at 50,000 USD per coin is 0.025 USD, so 0.02", () => {
			// 0.0000005 x 50000 = 0.025: 2.5 cents, 2 is even (half up gave 0.03).
			// 1 satoshi x 64545.123456 = 0.00064545... USD, 0.00.
			expect(
				resolveImportRate(row(0.0000005, "BTC", { exchangeRate: 50000 }), none)
					.amountInUSD,
			).toBe("0.02");
			expect(
				resolveImportRate(
					row(0.00000001, "BTC", { exchangeRate: 64545.123456 }),
					none,
				),
			).toEqual({ exchangeRate: "64545.123456", amountInUSD: "0.00" });
		});

		it("USD 1.005 is 100.5 cents, so 1.00", () => {
			expect(resolveImportRate(row(1.005, "USD"), none)).toEqual({
				exchangeRate: "1",
				amountInUSD: "1.00",
			});
		});

		it("a rate past 6 decimals rounds once, half to even", () => {
			// 1545.0000005 is a tie at 6 decimals: 0 is even, so 1545. The USD
			// value comes from the exact rate: 1545.0000005 / 1545.0000005 = 1.
			expect(
				resolveImportRate(
					row(1545.0000005, "ARS", { exchangeRate: 1545.0000005 }),
					none,
				),
			).toEqual({ exchangeRate: "1545", amountInUSD: "1.00" });
		});
	});
});

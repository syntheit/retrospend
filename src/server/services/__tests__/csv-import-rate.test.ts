import { describe, expect, it } from "vitest";
import { pickBestRate } from "~/lib/money";
import { resolveImportRate } from "../csv.service";

describe("resolveImportRate (CSV import and import finalize)", () => {
	const none = () => null;
	const date = new Date("2026-08-01");

	it("recomputes USD from a crypto rate by multiplying", () => {
		expect(
			resolveImportRate(
				{
					title: "x",
					amount: 0.5,
					currency: "btc",
					date,
					exchangeRate: 60000,
					amountInUSD: 0.0000083,
				},
				none,
			),
		).toEqual({ exchangeRate: 60000, amountInUSD: 30000 });
	});

	it("derives a fiat rate from a USD amount", () => {
		const r = resolveImportRate(
			{ title: "x", amount: 1560, currency: "ARS", date, amountInUSD: 1 },
			none,
		);
		expect(r.exchangeRate).toBeCloseTo(1560, 8);
		expect(r.amountInUSD).toBe(1);
	});

	it("falls back to the table rate for the row date", () => {
		const rows = [{ type: "official", rate: 5.1178, date: new Date("2026-07-29") }];
		const r = resolveImportRate(
			{ title: "x", amount: 51.178, currency: "BRL", date },
			(_c, d) => pickBestRate(rows, { date: d }),
		);
		expect(r).toEqual({ exchangeRate: 5.1178, amountInUSD: 10 });
	});

	it("throws instead of using rate 1 when nothing is known", () => {
		expect(() =>
			resolveImportRate({ title: "x", amount: 10, currency: "ARS", date }, none),
		).toThrow(/Missing exchange rate/);
	});
});

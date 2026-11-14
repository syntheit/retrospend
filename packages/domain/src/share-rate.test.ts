/**
 * shareRateOf: the one pick of a share's rate, used by the server's resolver
 * and by the device registry. Expected values are derived by hand.
 */
import { describe, expect, it } from "vitest";
import { rateLookup } from "./money";
import { priceShare, shareRateOf } from "./spent";

const share = (
	o: Partial<Parameters<ReturnType<typeof shareRateOf>>[0]> = {},
) => ({
	currency: "ARS",
	date: new Date("2026-10-10T15:00:00Z"),
	exchangeRate: null,
	...o,
});

describe("shareRateOf", () => {
	it("prices a USD share at 1 without asking the table", () => {
		const rateFor = shareRateOf(() => {
			throw new Error("a USD share never looks up a rate");
		});
		expect(rateFor(share({ currency: "USD" }))).toBe(1);
	});

	it("prefers the rate captured when the share was saved, as exact text", () => {
		// 1200.5 was captured; the table says 1500, which must not be read.
		const rateFor = shareRateOf(() => ({ rate: 1500 }));
		expect(rateFor(share({ exchangeRate: "1200.500000" }))).toBe("1200.5");
	});

	it("looks the table up on the share's own date, not today", () => {
		const seen: [string, string][] = [];
		const rateFor = shareRateOf((currency, date) => {
			seen.push([currency, date.toISOString()]);
			return { rate: 1500 };
		});
		expect(rateFor(share())).toBe(1500);
		expect(seen).toEqual([["ARS", "2026-10-10T15:00:00.000Z"]]);
	});

	it("is null, never 1, when the currency has no rate at all", () => {
		const rateFor = shareRateOf(() => null);
		const rate = rateFor(share({ currency: "XQZ" }));
		expect(rate).toBeNull();
		// An unpriced share keeps null rate and USD value, so a total names XQZ missing.
		expect(priceShare("500", "XQZ", rate)).toEqual({
			rate: null,
			amountInUSD: null,
		});
	});

	describe("over the in-memory rate table", () => {
		// ARS: blue 1,500 and official 1,000 on 2026-10-05. pickBestRate ranks
		// blue first when no type is preferred.
		const rows = {
			ARS: [
				{ type: "blue", rate: 1500, date: new Date("2026-10-05T12:00:00Z") },
				{
					type: "official",
					rate: 1000,
					date: new Date("2026-10-05T12:00:00Z"),
				},
			],
		};

		it("picks blue and prices 30,000 ARS at exactly 20 USD", () => {
			const rate = shareRateOf(rateLookup(rows))(share());
			expect(rate).toBe(1500);
			// 30000 ARS / 1500 ARS per USD = 20 USD.
			expect(priceShare("30000", "ARS", rate)).toEqual({
				rate: "1500",
				amountInUSD: "20",
			});
		});

		it("falls back to the nearest later rate when none is on or before the date", () => {
			const later = {
				ARS: [
					{ type: "blue", rate: 1400, date: new Date("2026-10-20T12:00:00Z") },
				],
			};
			expect(shareRateOf(rateLookup(later))(share())).toBe(1400);
		});

		it("is null for a currency the table lacks", () => {
			expect(shareRateOf(rateLookup(rows))(share({ currency: "JPY" }))).toBe(
				null,
			);
		});
	});
});

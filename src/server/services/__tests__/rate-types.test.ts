/**
 * Rate types per user and per entry (2A.2, N73, ADD-EXPENSE-R2 T7).
 *
 * Rates are DEFAULT_RATES (~/test/rate-table): ARS blue 1,560, official
 * 1,495, crypto 1,594.68; EUR official 0.8787; BTC 64,545.9 USD per coin;
 * CLP has none. Expected home values are worked out by hand below each case
 * (cross rate = USD per entry unit / USD per home unit, 12 decimals
 * half-even; home amount = amount x cross rate, half-even to minor units).
 */
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissingRateError } from "~/lib/money";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import {
	bookRate,
	defaultRateType,
	loadRateContext,
	type RateChoice,
	rateOptions,
	setDefaultRateType,
} from "../rate-types";

const DATE = new Date("2026-08-10T12:00:00Z");
const TABLE: RateChoice = { kind: "table", rateType: null };

describe("rate types", () => {
	let db: ReturnType<typeof createMockDb>;

	const asUser = (homeCurrency: string, defaultRateTypes: object = {}) =>
		db.user.findUnique.mockResolvedValue({ homeCurrency, defaultRateTypes });

	const book = async (
		amount: number,
		currency: string,
		choice: RateChoice = TABLE,
	) =>
		bookRate(
			db as never,
			await loadRateContext(db as never, "u1"),
			{
				amount,
				currency,
				date: DATE,
			},
			choice,
		);

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		asUser("ARS");
	});

	describe("booking from the table", () => {
		it("a USD expense in an ARS home books blue by default (T7)", async () => {
			// 12.99 x 1,560 = 20,264.40
			await expect(book(12.99, "USD")).resolves.toEqual({
				exchangeRate: 1,
				amountInUSD: 12.99,
				rateType: "blue",
				homeCurrency: "ARS",
				homeRate: "1560",
				homeAmount: "20264.40",
			});
		});

		it("books the type asked for: official 12.99 x 1,495 = 19,420.05", async () => {
			await expect(
				book(12.99, "USD", { kind: "table", rateType: "official" }),
			).resolves.toMatchObject({
				rateType: "official",
				homeRate: "1495",
				homeAmount: "19420.05",
			});
		});

		it("follows the user's default for their home", async () => {
			asUser("ARS", { ARS: "official" });
			await expect(book(12.99, "USD")).resolves.toMatchObject({
				rateType: "official",
				homeAmount: "19420.05",
			});
		});

		it("an ARS expense in a USD home: 1 / 1,560 = 0.000641025641, ARS 15,600 = USD 10.00", async () => {
			asUser("USD");
			await expect(book(15_600, "ARS")).resolves.toEqual({
				exchangeRate: 1560,
				amountInUSD: 10,
				rateType: "blue",
				homeCurrency: "USD",
				homeRate: "0.000641025641",
				homeAmount: "10.00",
			});
		});

		it("crosses two currencies through USD: EUR 100 at 1,560 / 0.8787", async () => {
			// 1,775.349948787982... x 100 = 177,534.99. EUR has no blue, so its
			// leg falls back to official; the label is the home leg's blue.
			await expect(book(100, "EUR")).resolves.toMatchObject({
				exchangeRate: 0.8787,
				amountInUSD: 113.8,
				rateType: "blue",
				homeRate: "1775.349948787982",
				homeAmount: "177534.99",
			});
		});

		it("crypto multiplies: BTC 0.01 at 64,545.9 x 1,560 = ARS 1,006,916.04", async () => {
			await expect(book(0.01, "BTC")).resolves.toMatchObject({
				exchangeRate: 64545.9,
				rateType: "blue",
				homeRate: "100691604",
				homeAmount: "1006916.04",
			});
		});

		it("a tiny rate keeps its digits: ARS 10,000,000 in a BTC home", async () => {
			// 1 / 1,560 / 64,545.9 = 9.931...e-9 BTC per ARS, stored as
			// 0.000000009931. The amount uses the exact rate: 0.09931315 BTC,
			// where the stored copy would give 0.09931000 (315 sat short).
			asUser("BTC");
			await expect(book(10_000_000, "ARS")).resolves.toMatchObject({
				homeRate: "0.000000009931",
				homeAmount: "0.09931315",
			});
		});

		it("a home-currency expense books itself: rate 1, its own amount", async () => {
			await expect(book(1000, "ARS")).resolves.toEqual({
				exchangeRate: 1560,
				amountInUSD: 0.64,
				rateType: "blue",
				homeCurrency: "ARS",
				homeRate: "1",
				homeAmount: "1000.00",
			});
		});

		it("USD to USD has no rate type", async () => {
			asUser("USD");
			await expect(book(5, "USD")).resolves.toMatchObject({
				rateType: null,
				homeRate: "1",
				homeAmount: "5.00",
			});
		});

		it("a missing entry rate is a MissingRateError, never 0 or 1", async () => {
			await expect(book(1000, "CLP")).rejects.toEqual(
				new MissingRateError("CLP"),
			);
		});

		it("a missing home rate blocks it too", async () => {
			asUser("CLP");
			await expect(book(10, "USD")).rejects.toBeInstanceOf(MissingRateError);
		});
	});

	describe("booking a typed or kept rate", () => {
		it("a custom rate for a USD expense: 1 USD = 1,500 ARS (T7)", async () => {
			await expect(
				book(12.99, "USD", { kind: "custom", base: "USD", value: "1500" }),
			).resolves.toEqual({
				exchangeRate: 1,
				amountInUSD: 12.99,
				rateType: "custom",
				homeCurrency: "ARS",
				homeRate: "1500",
				homeAmount: "19485.00",
			});
		});

		it("reads the rate either way round: 1 USD = 1,500 ARS for an ARS expense in a USD home", async () => {
			asUser("USD");
			const rate = await book(15_000, "ARS", {
				kind: "custom",
				base: "USD",
				value: "1500",
			});
			// 1 / 1,500 = 0.000666666667; 15,000 x that = 10.000000005 -> 10.00
			expect(rate).toMatchObject({
				amountInUSD: 10,
				homeRate: "0.000666666667",
				homeAmount: "10.00",
			});
			expect(rate.exchangeRate).toBeCloseTo(1500, 6);
		});

		it("derives the entry leg through the home's default rate: EUR 100 at 1 EUR = 1,800 ARS", async () => {
			// USD per EUR = 1,800 / 1,560; 100 EUR = USD 115.38
			const rate = await book(100, "EUR", {
				kind: "custom",
				base: "EUR",
				value: "1800",
			});
			expect(rate).toMatchObject({
				amountInUSD: 115.38,
				homeRate: "1800",
				homeAmount: "180000.00",
			});
			expect(rate.exchangeRate).toBeCloseTo(1560 / 1800, 6);
		});

		it("refuses a custom rate within one currency or of zero", async () => {
			await expect(
				book(10, "ARS", { kind: "custom", base: "ARS", value: "1" }),
			).rejects.toBeInstanceOf(TRPCError);
			await expect(
				book(10, "USD", { kind: "custom", base: "USD", value: "0" }),
			).rejects.toBeInstanceOf(TRPCError);
			for (const value of ["-5", "NaN", "Infinity", "1e3", ""]) {
				await expect(
					book(10, "USD", { kind: "custom", base: "USD", value }),
				).rejects.toBeInstanceOf(TRPCError);
			}
		});

		it("keeps a typed entry leg and books the home leg at the default", async () => {
			// ARS custom 1,500 per USD in a USD home: 1 / 1,500
			asUser("USD");
			await expect(
				book(1500, "ARS", {
					kind: "entryLeg",
					exchangeRate: 1500,
					rateType: "custom",
				}),
			).resolves.toMatchObject({
				exchangeRate: 1500,
				amountInUSD: 1,
				rateType: "custom",
				homeRate: "0.000666666667",
				homeAmount: "1.00",
			});
		});

		it("an old EUR row's official leg gets the home's blue leg", async () => {
			await expect(
				book(100, "EUR", {
					kind: "entryLeg",
					exchangeRate: 0.8787,
					rateType: "official",
				}),
			).resolves.toMatchObject({
				rateType: "blue",
				homeAmount: "177534.99",
			});
		});

		it("a kept row reuses its home rate for a new amount", async () => {
			await expect(
				book(20, "USD", {
					kind: "kept",
					exchangeRate: 1,
					homeRate: "1480",
					rateType: "blue",
				}),
			).resolves.toMatchObject({
				rateType: "blue",
				homeRate: "1480",
				homeAmount: "29600.00",
			});
			expect(db.exchangeRate.findMany).not.toHaveBeenCalled();
		});
	});

	describe("rateOptions (the Add sheet's strip)", () => {
		it("a USD expense in an ARS home offers every ARS type, Blue selected", async () => {
			const options = await rateOptions(db as never, "u1", {
				currency: "USD",
				date: DATE,
				amount: "12.99",
			});
			// 12.99 x 1,495 / 1,560 / 1,594.68
			expect(options).toEqual({
				homeCurrency: "ARS",
				defaultType: "blue",
				missing: null,
				custom: null,
				options: [
					{ rateType: "official", homeRate: "1495", homeAmount: "19420.05" },
					{ rateType: "blue", homeRate: "1560", homeAmount: "20264.40" },
					{
						rateType: "crypto",
						homeRate: "1594.68",
						homeAmount: "20714.89",
					},
				],
			});
		});

		it("books a typed rate as Save does: USD 12.99 at 1,500 is ARS 19,485", async () => {
			const options = await rateOptions(db as never, "u1", {
				currency: "USD",
				date: DATE,
				amount: "12.99",
				customRate: "1500",
			});
			expect(options.custom).toEqual({
				rateType: "custom",
				homeRate: "1500",
				homeAmount: "19485.00",
			});
		});

		it("a one-type pair offers one option", async () => {
			asUser("USD");
			await expect(
				rateOptions(db as never, "u1", { currency: "EUR", date: DATE }),
			).resolves.toMatchObject({
				defaultType: "official",
				options: [{ rateType: "official", homeAmount: null }],
			});
		});

		it("a home-currency expense offers none", async () => {
			await expect(
				rateOptions(db as never, "u1", { currency: "ARS", date: DATE }),
			).resolves.toMatchObject({
				defaultType: null,
				options: [],
				missing: null,
			});
		});

		it("names the currency with no rate (No rate yet)", async () => {
			await expect(
				rateOptions(db as never, "u1", { currency: "CLP", date: DATE }),
			).resolves.toMatchObject({
				defaultType: null,
				options: [],
				missing: { currency: "CLP" },
			});
		});
	});

	describe("defaultRateType (payments read it)", () => {
		it("is blue for USD in an ARS home", async () => {
			await expect(defaultRateType(db as never, "u1", "USD")).resolves.toBe(
				"blue",
			);
		});

		it("falls back when the saved type is gone from the table", async () => {
			asUser("ARS", { ARS: "mep" });
			await expect(defaultRateType(db as never, "u1", "USD")).resolves.toBe(
				"blue",
			);
		});

		it("is the saved one when the table has it", async () => {
			asUser("ARS", { ARS: "crypto" });
			await expect(defaultRateType(db as never, "u1", "EUR")).resolves.toBe(
				"crypto",
			);
		});

		it("is the table's order for a USD home: ARS blue, EUR official", async () => {
			asUser("USD");
			await expect(defaultRateType(db as never, "u1", "ARS")).resolves.toBe(
				"blue",
			);
			await expect(defaultRateType(db as never, "u1", "EUR")).resolves.toBe(
				"official",
			);
		});

		it("ignores a malformed saved value", async () => {
			asUser("ARS", { ARS: "Blue rate", usd: "official" });
			await expect(defaultRateType(db as never, "u1", "USD")).resolves.toBe(
				"blue",
			);
		});
	});

	describe("setDefaultRateType", () => {
		it("saves one home currency and keeps the others", async () => {
			asUser("ARS", { BOB: "official" });
			await expect(
				setDefaultRateType(db as never, "u1", "ARS", "mep"),
			).resolves.toEqual({ BOB: "official", ARS: "mep" });
			expect(db.user.update).toHaveBeenCalledWith({
				where: { id: "u1" },
				data: { defaultRateTypes: { BOB: "official", ARS: "mep" } },
			});
		});

		it("null goes back to the built-in default", async () => {
			asUser("ARS", { ARS: "mep" });
			await expect(
				setDefaultRateType(db as never, "u1", "ARS", null),
			).resolves.toEqual({});
		});

		it.each(["custom", "Blue rate", ""])("refuses %j", async (type) => {
			await expect(
				setDefaultRateType(db as never, "u1", "ARS", type),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect(db.user.update).not.toHaveBeenCalled();
		});
	});
});

/**
 * Expense money for any home currency (batch 3, bugs 1-3).
 *
 * The form keeps the stored rate convention (fiat: units per USD, crypto: USD
 * per coin) and the server recomputes amountInUSD, so the user's home currency
 * never leaks into what is stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	convertAmount,
	expenseAmounts,
	quoteRate,
	rateFromQuote,
} from "~/lib/money";
import { makeExpense } from "~/test/factories";
import { createMockDb } from "~/test/mock-db";
import { DEFAULT_RATES, useRateTable } from "~/test/rate-table";
import { ExpenseService } from "../expense.service";

const rateOf = (currency: string, type?: string) =>
	DEFAULT_RATES.find(
		(r) => r.currency === currency && (!type || r.type === type),
	)!.rate;

const HOMES = ["USD", "ARS", "BRL", "BTC"] as const;

const BASE = {
	id: "exp-1",
	title: "Dinner",
	date: new Date("2026-08-10T12:00:00Z"),
};

function createdData(db: ReturnType<typeof createMockDb>) {
	return (db.expense.create.mock.calls[0]![0] as {
		data: { exchangeRate: number; amountInUSD: number };
	}).data;
}

function updatedData(db: ReturnType<typeof createMockDb>) {
	return (db.expense.update.mock.calls[0]![0] as {
		data: { exchangeRate: number; amountInUSD: number };
	}).data;
}

describe("expense form math (client side)", () => {
	it.each(HOMES)(
		"100 EUR with %s home: stores the EUR rate and about 113.80 USD",
		(home) => {
			const { amountInUSD, homeAmount } = expenseAmounts({
				amount: 100,
				currency: "EUR",
				rate: rateOf("EUR"),
				homeCurrency: home,
				homeRate: home === "USD" ? 1 : rateOf(home),
			});
			expect(amountInUSD).toBe(113.8);
			expect(homeAmount).toBeCloseTo(
				convertAmount(100, "EUR", rateOf("EUR"), home, home === "USD" ? 1 : rateOf(home)),
				8,
			);
		},
	);

	it("100 EUR with ARS home shows about 177,535 ARS (not $0.06)", () => {
		const { amountInUSD, homeAmount } = expenseAmounts({
			amount: 100,
			currency: "EUR",
			rate: 0.8787,
			homeCurrency: "ARS",
			homeRate: 1560,
		});
		expect(amountInUSD).toBe(113.8);
		expect(homeAmount).toBeCloseTo(177535.0, 0);
	});

	it("0.01 BTC with ARS home is about 645 USD, not 1500x more", () => {
		const { amountInUSD } = expenseAmounts({
			amount: 0.01,
			currency: "BTC",
			rate: 64545.9,
			homeCurrency: "ARS",
			homeRate: 1560,
		});
		expect(amountInUSD).toBe(645.46);
	});

	it("100,000 ARS with ARS home is about 64 USD, not 100,000", () => {
		const { amountInUSD, homeAmount } = expenseAmounts({
			amount: 100000,
			currency: "ARS",
			rate: 1560,
			homeCurrency: "ARS",
			homeRate: 1560,
		});
		expect(amountInUSD).toBe(64.1);
		expect(homeAmount).toBe(100000);
	});

	it("leaves amountInUSD unknown until a rate is known (never rate 1)", () => {
		expect(
			expenseAmounts({
				amount: 100000,
				currency: "ARS",
				rate: undefined,
				homeCurrency: "ARS",
				homeRate: undefined,
			}).amountInUSD,
		).toBeUndefined();
	});

	it.each(HOMES)(
		"a custom quote typed with %s home maps back to the stored rate",
		(home) => {
			const homeRate = home === "USD" ? 1 : rateOf(home);
			for (const foreign of ["EUR", "JPY", "ETH"]) {
				const q = quoteRate(foreign, rateOf(foreign), home, homeRate);
				const typed = { ...q, value: Number(q.value.toPrecision(10)) };
				const stored = rateFromQuote(typed, foreign, home, homeRate);
				expect(stored / rateOf(foreign)).toBeCloseTo(1, 8);
			}
		},
	);
});

describe("ExpenseService money (server side)", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: ExpenseService;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		service = new ExpenseService(db as never);
		db.expense.create.mockResolvedValue(makeExpense());
		db.expense.update.mockResolvedValue(makeExpense());
	});

	describe("bug 1: the server does not trust client conversions", () => {
		it("100 EUR sent with an ARS-home cross rate is stored at the EUR rate", async () => {
			// What the old form sent: 1 EUR = 1775 ARS as the rate, $0.06 total.
			await service.createExpense("user-1", {
				...BASE,
				amount: 100,
				currency: "EUR",
				exchangeRate: 1775.35,
				amountInUSD: 0.06,
				pricingSource: "official",
			});
			expect(createdData(db)).toMatchObject({
				exchangeRate: 0.8787,
				amountInUSD: 113.8,
			});
		});

		it("crypto sent with an ARS-home cross rate is not 1500x too large", async () => {
			await service.createExpense("user-1", {
				...BASE,
				amount: 0.01,
				currency: "BTC",
				exchangeRate: 64545.9 * 1560,
				amountInUSD: 1006916.04,
				pricingSource: "crypto",
			});
			expect(createdData(db)).toMatchObject({
				exchangeRate: 64545.9,
				amountInUSD: 645.46,
			});
		});

		it.each([
			["EUR", 100, 113.8],
			["BRL", 100, 19.54],
			["JPY", 10000, 61.04],
			["ETH", 0.5, 958.31],
		])("%s: amountInUSD always comes from the stored rate", async (currency, amount, usd) => {
			await service.createExpense("user-1", {
				...BASE,
				amount,
				currency,
				amountInUSD: 999999,
			});
			expect(createdData(db).amountInUSD).toBe(usd);
		});

		it("a custom rate is kept, but amountInUSD is still recomputed", async () => {
			await service.createExpense("user-1", {
				...BASE,
				amount: 100,
				currency: "EUR",
				exchangeRate: 0.9,
				amountInUSD: 1,
				pricingSource: "custom",
			});
			expect(createdData(db)).toMatchObject({
				exchangeRate: 0.9,
				amountInUSD: 111.11,
			});
		});

		it("the pricingSource rate type is honored (ARS official vs blue)", async () => {
			await service.createExpense("user-1", {
				...BASE,
				amount: 14950,
				currency: "ARS",
				pricingSource: "official",
			});
			expect(createdData(db)).toMatchObject({
				exchangeRate: 1495,
				amountInUSD: 10,
			});
		});
	});

	describe("bug 2: home currency expense is converted, not stored at rate 1", () => {
		it("100,000 ARS sent with rate 1 and amountInUSD 100,000 is stored as about $64", async () => {
			await service.createExpense("user-1", {
				...BASE,
				amount: 100000,
				currency: "ARS",
				exchangeRate: 1,
				amountInUSD: 100000,
				pricingSource: "blue",
			});
			expect(createdData(db)).toMatchObject({
				exchangeRate: 1560,
				amountInUSD: 64.1,
			});
		});

		it.each([
			["BRL", 1000, 195.4],
			["BTC", 0.001, 64.55],
		])("%s home currency: never rate 1", async (currency, amount, usd) => {
			await service.createExpense("user-1", {
				...BASE,
				amount,
				currency,
				exchangeRate: 1,
				amountInUSD: amount,
				pricingSource: "official",
			});
			expect(createdData(db).amountInUSD).toBe(usd);
			expect(createdData(db).exchangeRate).not.toBe(1);
		});

		it("USD stays at rate 1 for every home", async () => {
			await service.createExpense("user-1", {
				...BASE,
				amount: 42.5,
				currency: "USD",
				exchangeRate: 1560,
			});
			expect(createdData(db)).toMatchObject({ exchangeRate: 1, amountInUSD: 42.5 });
		});
	});

	describe("bug 3: updates recompute instead of keeping stale values", () => {
		const existingArs = () =>
			makeExpense({
				id: "exp-1",
				userId: "user-1",
				amount: 1000,
				currency: "ARS",
				exchangeRate: 1250,
				amountInUSD: 0.8,
				pricingSource: "blue",
			});

		it("changing the amount without sending a rate recomputes amountInUSD at the stored rate", async () => {
			db.expense.findFirst.mockResolvedValue(existingArs());

			await service.updateExpense("user-1", {
				...BASE,
				amount: 5000,
				currency: "ARS",
			});

			expect(updatedData(db)).toMatchObject({
				exchangeRate: 1250,
				amountInUSD: 4,
			});
		});

		it("sending back the stored rate keeps the historical rate", async () => {
			db.expense.findFirst.mockResolvedValue(existingArs());

			await service.updateExpense("user-1", {
				...BASE,
				amount: 2500,
				currency: "ARS",
				exchangeRate: 1250,
				amountInUSD: 0.8,
				pricingSource: "blue",
			});

			expect(updatedData(db)).toMatchObject({
				exchangeRate: 1250,
				amountInUSD: 2,
			});
		});

		it("changing the currency without a rate looks up the new currency's rate", async () => {
			db.expense.findFirst.mockResolvedValue(existingArs());

			await service.updateExpense("user-1", {
				...BASE,
				amount: 100,
				currency: "EUR",
			});

			expect(updatedData(db)).toMatchObject({
				exchangeRate: 0.8787,
				amountInUSD: 113.8,
			});
		});

		it("changing to USD drops the old rate", async () => {
			db.expense.findFirst.mockResolvedValue(existingArs());

			await service.updateExpense("user-1", {
				...BASE,
				amount: 20,
				currency: "USD",
			});

			expect(updatedData(db)).toMatchObject({ exchangeRate: 1, amountInUSD: 20 });
		});

		it("picking another rate type uses the table rate of that type", async () => {
			db.expense.findFirst.mockResolvedValue(existingArs());

			await service.updateExpense("user-1", {
				...BASE,
				amount: 14950,
				currency: "ARS",
				exchangeRate: 1495,
				pricingSource: "official",
			});

			expect(updatedData(db)).toMatchObject({
				exchangeRate: 1495,
				amountInUSD: 10,
			});
		});
	});

	describe("missing rates", () => {
		it("a past date with only a newer rate uses that nearest rate", async () => {
			await service.createExpense("user-1", {
				...BASE,
				date: new Date("2025-01-15T12:00:00Z"),
				amount: 1560,
				currency: "ARS",
			});
			expect(createdData(db)).toMatchObject({ exchangeRate: 1560, amountInUSD: 1 });
		});

		it("a currency without any rate fails instead of using 1", async () => {
			await expect(
				service.createExpense("user-1", { ...BASE, amount: 10, currency: "XAU" }),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect(db.expense.create).not.toHaveBeenCalled();
		});
	});
});

/**
 * What saving an expense stores for its rate, pinned before the rate type
 * per entry work (IMPLEMENTATION 2A.2). The stored entry leg (exchangeRate,
 * amountInUSD, pricingSource) must come out the same afterwards; the home
 * leg is new and tested in expense-rate.test.ts.
 *
 * Rates are DEFAULT_RATES (~/test/rate-table): ARS blue 1,560, official
 * 1,495, crypto 1,594.68; EUR 0.8787; BTC 64,545.9 USD per coin. CLP has
 * none. The user's home is ARS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeExpense } from "~/test/factories";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import { ExpenseService } from "../expense.service";

const DATE = new Date("2026-08-10T12:00:00Z");
const BASE = { id: "exp-1", title: "Dinner", date: DATE };

type Stored = {
	exchangeRate: number;
	amountInUSD: number;
	pricingSource?: string;
};

describe("expense rate on save today (characterization)", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: ExpenseService;

	const created = () =>
		(db.expense.create.mock.calls[0]![0] as { data: Stored }).data;
	const updated = () =>
		(db.expense.update.mock.calls[0]![0] as { data: Stored }).data;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		db.user.findUnique.mockResolvedValue({
			homeCurrency: "ARS",
			defaultRateTypes: {},
		});
		db.expense.create.mockResolvedValue(makeExpense());
		db.expense.update.mockResolvedValue(makeExpense());
		service = new ExpenseService(db as never);
	});

	it("USD 12.99 stores rate 1 and USD 12.99, whatever type the form sent (T7)", async () => {
		await service.createExpense("user-1", {
			...BASE,
			amount: 12.99,
			currency: "USD",
			pricingSource: "official",
		});
		expect(created()).toMatchObject({
			exchangeRate: 1,
			amountInUSD: 12.99,
			pricingSource: "official",
		});
	});

	it("ARS with no type takes blue: 15,600 / 1,560 = USD 10", async () => {
		await service.createExpense("user-1", {
			...BASE,
			amount: 15_600,
			currency: "ARS",
		});
		expect(created()).toMatchObject({
			exchangeRate: 1560,
			amountInUSD: 10,
			pricingSource: "MANUAL",
		});
	});

	it("ARS official: 14,950 / 1,495 = USD 10", async () => {
		await service.createExpense("user-1", {
			...BASE,
			amount: 14_950,
			currency: "ARS",
			pricingSource: "official",
		});
		expect(created()).toMatchObject({
			exchangeRate: 1495,
			amountInUSD: 10,
			pricingSource: "official",
		});
	});

	it("ARS custom 1,500 is kept: 1,500 / 1,500 = USD 1", async () => {
		await service.createExpense("user-1", {
			...BASE,
			amount: 1500,
			currency: "ARS",
			exchangeRate: 1500,
			pricingSource: "custom",
		});
		expect(created()).toMatchObject({
			exchangeRate: 1500,
			amountInUSD: 1,
			pricingSource: "custom",
		});
	});

	it("a type the currency lacks falls back to its best rate", async () => {
		await service.createExpense("user-1", {
			...BASE,
			amount: 100,
			currency: "EUR",
			pricingSource: "blue",
		});
		// 100 / 0.8787 = 113.8045 -> 113.80
		expect(created()).toMatchObject({
			exchangeRate: 0.8787,
			amountInUSD: 113.8,
		});
	});

	it("BTC multiplies: 0.01 x 64,545.9 = USD 645.46", async () => {
		await service.createExpense("user-1", {
			...BASE,
			amount: 0.01,
			currency: "BTC",
		});
		expect(created()).toMatchObject({
			exchangeRate: 64545.9,
			amountInUSD: 645.46,
		});
	});

	it("a currency with no rate is refused, never stored at 1", async () => {
		await expect(
			service.createExpense("user-1", {
				...BASE,
				amount: 1000,
				currency: "CLP",
			}),
		).rejects.toThrow(/CLP/);
		expect(db.expense.create).not.toHaveBeenCalled();
	});

	describe("editing", () => {
		const existing = makeExpense({
			id: "exp-1",
			userId: "user-1",
			currency: "ARS",
			amount: 14_000,
			exchangeRate: 1400,
			amountInUSD: 10,
			pricingSource: "blue",
			date: new Date("2026-05-01T12:00:00Z"),
		});

		beforeEach(() => db.expense.findFirst.mockResolvedValue(existing));

		it("keeps the saved rate when the form sends it back, even with a new date", async () => {
			await service.updateExpense("user-1", {
				...BASE,
				amount: 28_000,
				currency: "ARS",
				exchangeRate: 1400,
				pricingSource: "blue",
			});
			expect(updated()).toMatchObject({ exchangeRate: 1400, amountInUSD: 20 });
		});

		it("keeps the saved rate when the form sends none", async () => {
			await service.updateExpense("user-1", {
				...BASE,
				amount: 14_000,
				currency: "ARS",
			});
			expect(updated()).toMatchObject({ exchangeRate: 1400, amountInUSD: 10 });
		});

		it("looks the rate up again when the currency changes", async () => {
			await service.updateExpense("user-1", {
				...BASE,
				amount: 100,
				currency: "EUR",
				exchangeRate: 1400,
			});
			expect(updated()).toMatchObject({
				exchangeRate: 0.8787,
				amountInUSD: 113.8,
			});
		});
	});
});

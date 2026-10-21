import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { MissingRateError } from "~/lib/money";
import { createMockDb } from "~/test/mock-db";
import { DEFAULT_RATES, RATE_DATE, type TestRateRow, useRateTable } from "~/test/rate-table";
import { WealthService } from "../wealth.service";

// calculateBalanceInUSD is synchronous and never touches the db.
const svc = new WealthService({} as never);

describe("WealthService.calculateBalanceInUSD", () => {
	it("crypto multiplies by the USD price", () => {
		expect(svc.calculateBalanceInUSD(0.5, 50000, "BTC")).toBe(25000);
		expect(svc.calculateBalanceInUSD(1000, 0.08, "DOGE")).toBeCloseTo(80);
	});

	it("fiat divides by units per USD, strong or weak", () => {
		expect(svc.calculateBalanceInUSD(5000, 1415, "ARS")).toBeCloseTo(3.534, 3);
		expect(svc.calculateBalanceInUSD(1000, 0.92, "EUR")).toBeCloseTo(1087, 0);
		expect(svc.calculateBalanceInUSD(100, 0.3102, "KWD")).toBeCloseTo(322.4, 1);
		expect(svc.calculateBalanceInUSD(100, 1, "USD")).toBe(100);
	});

	it("negative balances (overdrafts) convert instead of throwing", () => {
		expect(svc.calculateBalanceInUSD(-156000, 1560, "ARS")).toBeCloseTo(-100);
		expect(svc.calculateBalanceInUSD(-5000, 163.83, "JPY")).toBeCloseTo(-30.52, 2);
	});

	it("throws for a zero or negative rate", () => {
		expect(() => svc.calculateBalanceInUSD(100, 0, "ARS")).toThrow(TRPCError);
		expect(() => svc.calculateBalanceInUSD(100, -1, "ARS")).toThrow(TRPCError);
	});
});

describe("WealthService.resolveExchangeRate", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: WealthService;

	beforeEach(() => {
		db = createMockDb();
		useRateTable(db);
		service = new WealthService(db as never);
	});

	it("USD is always 1", async () => {
		await expect(service.resolveExchangeRate("USD", RATE_DATE)).resolves.toEqual({
			rate: 1,
			rateType: null,
		});
	});

	it("looks up the requested type instead of trusting the sent number", async () => {
		await expect(
			service.resolveExchangeRate("ARS", RATE_DATE, { rate: 0.00067, type: "official" }),
		).resolves.toEqual({ rate: 1495, rateType: "official" });
	});

	it("keeps a custom rate as typed", async () => {
		await expect(
			service.resolveExchangeRate("ARS", RATE_DATE, { rate: 1700, type: "custom" }),
		).resolves.toEqual({ rate: 1700, rateType: "custom" });
	});

	it("a currency without rates is a BAD_REQUEST", async () => {
		await expect(service.resolveExchangeRate("XYZ", RATE_DATE)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});

describe("WealthService.getDashboardSummary", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: WealthService;

	function asset(overrides: Record<string, unknown>) {
		return {
			id: "a1",
			name: "Account",
			type: "CASH",
			currency: "USD",
			balance: 0,
			exchangeRate: null,
			exchangeRateType: null,
			isLiquid: true,
			interestRate: null,
			createdAt: new Date(2026, 0, 1),
			updatedAt: new Date(2026, 0, 1),
			...overrides,
		};
	}

	beforeEach(() => {
		db = createMockDb();
		useRateTable(db);
		service = new WealthService(db as never);
		db.assetSnapshot.findMany.mockResolvedValue([]);
		db.assetSnapshot.findFirst.mockResolvedValue(null);
	});

	it("ARS home: ARS balance as is, USD at the ARS rate, crypto via USD", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "pesos", currency: "ARS", balance: 1000000, exchangeRateType: "blue" }),
			asset({ id: "dollars", currency: "USD", balance: 500 }),
			asset({ id: "btc", currency: "BTC", balance: 0.01, exchangeRateType: "crypto", isLiquid: false }),
		]);

		const summary = await service.getDashboardSummary("user-1", "ARS");

		expect(summary.totalNetWorth).toBeCloseTo(1000000 + 500 * 1560 + 645.459 * 1560, 2);
		expect(summary.totalLiquidAssets).toBeCloseTo(1000000 + 500 * 1560, 2);
		expect(summary.assets.find((a) => a.id === "pesos")!.balanceInTargetCurrency).toBe(1000000);
	});

	it("USD home: each asset uses its own rate type", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "blue", currency: "ARS", balance: 1560000, exchangeRateType: "blue" }),
			asset({ id: "official", currency: "ARS", balance: 1495000, exchangeRateType: "official" }),
		]);

		const summary = await service.getDashboardSummary("user-1", "USD");

		expect(summary.assets.map((a) => a.balanceInUSD)).toEqual([1000, 1000]);
		expect(summary.totalNetWorth).toBeCloseTo(2000);
	});

	it("a custom rate wins over the table", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ currency: "ARS", balance: 200000, exchangeRate: 2000, exchangeRateType: "custom" }),
		]);

		const summary = await service.getDashboardSummary("user-1", "USD");

		expect(summary.totalNetWorth).toBeCloseTo(100);
	});

	it("liabilities subtract, negative balances included", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "cash", currency: "EUR", balance: 878.7, exchangeRateType: "official" }),
			asset({ id: "card", type: "LIABILITY_CREDIT_CARD", currency: "USD", balance: 300, interestRate: 40 }),
			asset({ id: "overdraft", currency: "ARS", balance: -156000, exchangeRateType: "blue" }),
		]);

		const summary = await service.getDashboardSummary("user-1", "USD");

		expect(summary.totalAssets).toBeCloseTo(1000 - 100);
		expect(summary.totalLiabilities).toBeCloseTo(300);
		expect(summary.totalNetWorth).toBeCloseTo(600);
		expect(summary.weightedAPR).toBe(40);
	});

	it("an asset whose currency has no rate is left out and reported, not taken 1:1", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "usd", balance: 100 }),
			asset({ id: "odd", currency: "XYZ", balance: 1000000 }),
		]);

		const summary = await service.getDashboardSummary("user-1", "USD");

		expect(summary.totalNetWorth).toBe(100);
		expect(summary.missingRateCurrencies).toEqual(["XYZ"]);
		expect(summary.assets.find((a) => a.id === "odd")!.rateMissing).toBe(true);
	});

	it("falls back to the asset's stored rate when its currency has no table rate", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ currency: "XYZ", balance: 1000, exchangeRate: 10, exchangeRateType: "official" }),
		]);

		const summary = await service.getDashboardSummary("user-1", "USD");

		expect(summary.totalNetWorth).toBe(100);
		expect(summary.missingRateCurrencies).toEqual([]);
	});

	it("a home currency with no rate is an error", async () => {
		db.assetAccount.findMany.mockResolvedValue([asset({ balance: 100 })]);

		await expect(service.getDashboardSummary("user-1", "XYZ")).rejects.toBeInstanceOf(
			MissingRateError,
		);
	});

	it("history values each day at that day's rates, not today's", async () => {
		const OLD = new Date("2026-03-01T00:00:00Z");
		const rows: TestRateRow[] = [
			...DEFAULT_RATES,
			{ currency: "ARS", type: "blue", rate: 1000, date: OLD },
			{ currency: "EUR", type: "official", rate: 0.9, date: OLD },
		];
		useRateTable(db, rows);
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "pesos", currency: "ARS", balance: 1560000, exchangeRateType: "blue" }),
		]);
		db.assetSnapshot.findMany.mockResolvedValue([
			{ accountId: "pesos", date: new Date("2026-03-10T00:00:00Z"), balance: 1000000, balanceInUSD: 1000 },
		]);

		const usdHome = await service.getDashboardSummary("user-1", "USD");
		const eurHome = await service.getDashboardSummary("user-1", "EUR");

		const marchUSD = usdHome.history.find((h) => h.date === "2026-03-10")!;
		expect(marchUSD.amount).toBeCloseTo(1000); // 1M ARS at 1000, not at 1560
		const marchEUR = eurHome.history.find((h) => h.date === "2026-03-10")!;
		expect(marchEUR.amount).toBeCloseTo(900); // EUR rate of that day too
		// Today's point matches the headline total
		expect(usdHome.history.at(-1)!.amount).toBeCloseTo(usdHome.totalNetWorth);
		expect(usdHome.totalNetWorth).toBeCloseTo(1000);
	});

	it("history falls back to the snapshot's recorded USD value when no rate exists", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "odd", currency: "XYZ", balance: 5 }),
		]);
		db.assetSnapshot.findMany.mockResolvedValue([
			{ accountId: "odd", date: new Date("2026-03-10T00:00:00Z"), balance: 5, balanceInUSD: 42 },
		]);

		const summary = await service.getDashboardSummary("user-1", "USD");

		expect(summary.history.find((h) => h.date === "2026-03-10")!.amount).toBe(42);
	});
});

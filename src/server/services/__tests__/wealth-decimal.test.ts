/**
 * The Wealth dashboard in exact decimals (docs/roadmap/money-decimal.md,
 * PR 4b). Home ARS at blue 1,545 per USD; JPY official 150 per USD; BTC
 * 60,000 USD per coin. Every expected value is derived by hand.
 *
 * - Cash, ARS 1,000,000 blue: ARS 1,000,000.00.
 * - Wise, USD 1,840.55 (no rate type, USD is 1): 1,840.55 x 1,545 =
 *   2,760,825 + 82,824.75 = ARS 2,843,649.75.
 * - Bitcoin, BTC 0.01234567: 0.01234567 x 60,000 = USD 740.7402, x 1,545 =
 *   1,143,300 + 1,143.609 = ARS 1,144,443.609, which rounds to .61.
 * - Yen, JPY 150,000: 150,000 / 150 = USD 1,000, x 1,545 = ARS 1,545,000.
 * - Card, USD 300 owed at 40 percent: ARS 463,500.
 * - Loan, ARS 842,600 owed, no interest.
 * Assets 6,533,093.34 (1,000,000 + 2,843,649.75 + 1,144,443.609 + 1,545,000
 * = 6,533,093.359, rounded once); liabilities 1,306,100; net worth
 * 5,226,993.359 -> 5,226,993.36.
 */
import { MissingRateError } from "@retrospend/domain/money-dec";
import { dec } from "@retrospend/domain/precise-decimal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type HeldSnapshot,
	usdWithoutRate,
} from "~/server/services/accounts/dashboard-rates";
import { createMockDb } from "~/test/mock-db";
import { RATE_DATE, type TestRateRow, useRateTable } from "~/test/rate-table";
import { WealthService } from "../wealth.service";

const RATES: TestRateRow[] = [
	{ currency: "USD", type: "official", rate: 1, date: RATE_DATE },
	{ currency: "ARS", type: "blue", rate: 1545, date: RATE_DATE },
	{ currency: "JPY", type: "official", rate: 150, date: RATE_DATE },
	{ currency: "BTC", type: "crypto", rate: 60000, date: RATE_DATE },
];

function asset(overrides: Record<string, unknown>) {
	return {
		id: "a1",
		name: "Account",
		type: "CASH",
		currency: "USD",
		balance: "0",
		exchangeRate: null,
		exchangeRateType: null,
		isLiquid: true,
		interestRate: null,
		createdAt: new Date(2026, 0, 1),
		updatedAt: new Date(2026, 0, 1),
		...overrides,
	};
}

const ACCOUNTS = [
	asset({
		id: "cash",
		currency: "ARS",
		balance: "1000000",
		exchangeRateType: "blue",
	}),
	asset({
		id: "wise",
		balance: "1840.55",
		type: "INVESTMENT",
		isLiquid: false,
	}),
	asset({
		id: "btc",
		currency: "BTC",
		balance: "0.01234567",
		exchangeRateType: "crypto",
		type: "CRYPTO",
		isLiquid: false,
	}),
	asset({
		id: "yen",
		currency: "JPY",
		balance: "150000",
		exchangeRateType: "official",
	}),
	asset({
		id: "card",
		type: "LIABILITY_CREDIT_CARD",
		balance: "300",
		interestRate: "40",
	}),
	asset({
		id: "loan",
		type: "LIABILITY_LOAN",
		currency: "ARS",
		balance: "842600",
		exchangeRateType: "blue",
	}),
];

describe("WealthService.getDashboardSummary in exact decimals", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: WealthService;

	beforeEach(() => {
		db = createMockDb();
		useRateTable(db, RATES);
		Object.assign(db, {
			accountLeg: { findMany: vi.fn().mockResolvedValue([]) },
			assetRateType: { findMany: vi.fn().mockResolvedValue([]) },
		});
		service = new WealthService(db as never);
		db.assetSnapshot.findMany.mockResolvedValue([]);
		db.assetSnapshot.findFirst.mockResolvedValue(null);
		db.assetAccount.findMany.mockResolvedValue(ACCOUNTS);
	});

	it("totals fiat, crypto and liabilities exactly, rounding the sum once", async () => {
		const s = await service.getDashboardSummary("u", "ARS");

		expect(s.totalAssets).toBe(6_533_093.36);
		expect(s.totalLiabilities).toBe(1_306_100);
		expect(s.totalNetWorth).toBe(5_226_993.36);
		// Liquid: the cash and the yen account.
		expect(s.totalLiquidAssets).toBe(2_545_000);
		const row = (id: string) => s.assets.find((a) => a.id === id);
		expect(row("wise")?.balanceInTargetCurrency).toBe(2_843_649.75);
		expect(row("btc")?.balanceInTargetCurrency).toBe(1_144_443.61);
		expect(row("yen")?.balanceInTargetCurrency).toBe(1_545_000);
		// USD value of the coin: 740.7402 to cents.
		expect(row("btc")?.balanceInUSD).toBe(740.74);
		// One unit in the target: the rate the account is valued at.
		expect(row("btc")?.homePerUnit).toBe(92_700_000);
		expect(row("yen")?.homePerUnit).toBe(10.3);
		expect(s.missingRateCurrencies).toEqual([]);
	});

	it("weights the APR by the USD owed, and ignores a card in credit", async () => {
		// 40 x 300 / 300 = 40; a card in credit (-50) lowers the owed total but
		// carries no weight: (40 x 300) / (300 - 50) = 48.
		db.assetAccount.findMany.mockResolvedValue([
			asset({
				id: "card",
				type: "LIABILITY_CREDIT_CARD",
				balance: "300",
				interestRate: "40",
			}),
			asset({
				id: "credit",
				type: "LIABILITY_CREDIT_CARD",
				balance: "-50",
				interestRate: "10",
			}),
		]);

		const s = await service.getDashboardSummary("u", "ARS");

		expect(s.weightedAPR).toBe(48);
		// 250 x 1,545 = 386,250.
		expect(s.totalLiabilities).toBe(386_250);
		expect(s.totalNetWorth).toBe(-386_250);
	});

	it("rounds a true tie half to even: USD 0.001 is ARS 1.545, USD 0.003 is 4.635", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "one", balance: "0.001" }),
		]);
		const low = await service.getDashboardSummary("u", "ARS");
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "three", balance: "0.003" }),
		]);
		const high = await service.getDashboardSummary("u", "ARS");

		// 1.545 -> 1.54 (4 is even); 4.635 -> 4.64 (3 is odd).
		expect(low.totalNetWorth).toBe(1.54);
		expect(high.totalNetWorth).toBe(4.64);
	});

	it("negative ties are sign symmetric and never read -0", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "debt", balance: "-0.001" }),
		]);
		const negative = await service.getDashboardSummary("u", "ARS");
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "dust", currency: "ARS", balance: "-0.001" }),
		]);
		const dust = await service.getDashboardSummary("u", "ARS");

		// -1.545 -> -1.54; ARS -0.001 is -0.1 cents: 0, not -0.
		expect(negative.totalNetWorth).toBe(-1.54);
		expect(Object.is(dust.totalNetWorth, 0)).toBe(true);
		expect(Object.is(dust.totalAssets, 0)).toBe(true);
	});

	it("a JPY home rounds to whole yen: ARS 1,000,000 / 1,545 x 150 = 97,087.378... -> 97,087", async () => {
		db.assetAccount.findMany.mockResolvedValue([ACCOUNTS[0]]);

		const s = await service.getDashboardSummary("u", "JPY");

		expect(s.totalNetWorth).toBe(97_087);
	});

	it("a BTC home keeps eight decimals: USD 1,000 / 60,000 = 0.01666667", async () => {
		db.assetAccount.findMany.mockResolvedValue([asset({ balance: "1000" })]);

		const s = await service.getDashboardSummary("u", "BTC");

		expect(s.totalNetWorth).toBe(0.01666667);
	});

	it("an account with no rate is left out and named, never 1 and never 0 in a total", async () => {
		db.assetAccount.findMany.mockResolvedValue([
			asset({ id: "usd", balance: "100" }),
			asset({ id: "odd", currency: "XYZ", balance: "1000000" }),
		]);

		const s = await service.getDashboardSummary("u", "ARS");

		expect(s.missingRateCurrencies).toEqual(["XYZ"]);
		expect(s.totalNetWorth).toBe(154_500);
	});

	it("a home currency with no rate throws naming it", async () => {
		db.assetAccount.findMany.mockResolvedValue([asset({ balance: "100" })]);

		const error = await service
			.getDashboardSummary("u", "XYZ")
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(MissingRateError);
		expect((error as MissingRateError).currency).toBe("XYZ");
	});

	it("a past day uses the rule of today's figure: the same balances give the same total", async () => {
		const day = new Date("2026-10-01T00:00:00Z");
		db.assetSnapshot.findMany.mockResolvedValue(
			ACCOUNTS.map((a) => ({
				accountId: a.id,
				date: day,
				recordedAt: day,
				balance: a.balance,
				balanceInUSD: "0",
				currency: a.currency,
				type: a.type,
				exchangeRateType: a.exchangeRateType,
			})),
		);

		const s = await service.getDashboardSummary("u", "ARS");
		const point = s.history.find((h) => h.date === "2026-10-01");

		expect(point).toEqual({
			date: "2026-10-01",
			amount: s.totalNetWorth,
			assets: s.totalAssets,
			liabilities: s.totalLiabilities,
		});
	});
});

describe("usdWithoutRate", () => {
	const snap = (balance: string, usd: string): HeldSnapshot => ({
		balance: dec(balance),
		balanceInUSD: dec(usd),
		currency: "JPY",
		type: "CASH",
		exchangeRateType: null,
		date: new Date("2026-03-10T00:00:00Z"),
		recordedAt: new Date("2026-03-10T00:00:00Z"),
	});

	it("keeps the recorded USD value while the balance is unchanged", () => {
		expect(usdWithoutRate(snap("3", "10"), dec("3"), null)?.toFixed()).toBe(
			"10",
		);
	});

	it("scales the recorded USD value by the balance in one division", () => {
		// 10 x 4 / 3 = 13.3333...: not cut to cents or to a float.
		const usd = usdWithoutRate(snap("3", "10"), dec("4"), null);
		expect(usd?.toFixed(20)).toBe("13.33333333333333333333");
	});

	it("with nothing recorded to scale, uses the stored rate: 300 JPY at 150 is USD 2", () => {
		expect(usdWithoutRate(snap("0", "0"), dec("300"), "150")?.toFixed()).toBe(
			"2",
		);
	});

	it("with no recorded value and no rate there is no value, never 0", () => {
		expect(usdWithoutRate(snap("0", "0"), dec("300"), null)).toBeNull();
		expect(usdWithoutRate(snap("0", "0"), dec("300"), "0")).toBeNull();
	});
});

/**
 * The Wealth dashboard values an account with accounts/valuation.ts, the
 * function the net worth figure and API v1 read (docs/roadmap/money-decimal.md,
 * PR 4c). Every expected value is derived by hand.
 *
 * - 1 EUR at 3 per USD into JPY at 16.5 per USD: 16.5 / 3 = 5.5 JPY exactly,
 *   a tie that rounds half to even to 6. The old two divisions, (1/3) / (1/16.5),
 *   gave 5.4999...9 and 5 on the other readers.
 * - 1.2 EUR is 6.6 JPY, no tie: 7.
 * - 0.01234567 BTC at 60,000 USD, into ARS at 1,545 per USD: 0.01234567 x
 *   92,700,000 = 1,144,443.609 (rounds to .61).
 * - History: an account with no rate on a day is a gap and is named, never a
 *   value that dropped its legs or read a missing recorded USD value as 0.
 */
import {
	homeValue,
	ratePickFromRows,
} from "@retrospend/domain/accounts/valuation";
import { isCrypto } from "@retrospend/domain/currency-format";
import { roundedMajor } from "@retrospend/domain/money-minor";
import { dec } from "@retrospend/domain/precise-decimal";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";
import {
	RATE_DATE,
	type TestRateRow,
	useRateTable as seedRateTable,
} from "~/test/rate-table";
import { WealthService } from "../wealth.service";

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

function setup(rates: TestRateRow[], accounts: unknown[]) {
	const db = createMockDb();
	seedRateTable(db, rates);
	Object.assign(db, {
		accountLeg: { findMany: vi.fn().mockResolvedValue([]) },
		assetRateType: { findMany: vi.fn().mockResolvedValue([]) },
	});
	db.assetSnapshot.findMany.mockResolvedValue([]);
	db.assetSnapshot.findFirst.mockResolvedValue(null);
	db.assetAccount.findMany.mockResolvedValue(accounts);
	return { db, service: new WealthService(db as never) };
}

const official = (currency: string, rate: number): TestRateRow => ({
	currency,
	type: "official",
	rate,
	date: RATE_DATE,
});

describe("a tie on a JPY home", () => {
	const rates = [official("EUR", 3), official("JPY", 16.5)];

	it("1 EUR is 5.5 JPY exactly: the row and the total round to 6", async () => {
		const { service } = setup(rates, [
			asset({ id: "eur", currency: "EUR", balance: "1" }),
		]);

		const s = await service.getDashboardSummary("u", "JPY");

		expect(s.assets[0]?.balanceInTargetCurrency).toBe(6);
		expect(s.totalAssets).toBe(6);
		expect(s.totalNetWorth).toBe(6);
		// The rate the row is valued at: 16.5 / 3.
		expect(s.assets[0]?.homePerUnit).toBe(5.5);
	});

	it("a non-tie control: 1.2 EUR is 6.6 JPY, which rounds to 7", async () => {
		const { service } = setup(rates, [
			asset({ id: "eur", currency: "EUR", balance: "1.2" }),
		]);

		const s = await service.getDashboardSummary("u", "JPY");

		expect(s.assets[0]?.balanceInTargetCurrency).toBe(7);
		expect(s.totalNetWorth).toBe(7);
	});
});

describe("a coin on an ARS home", () => {
	it("0.01234567 BTC is ARS 1,144,443.609: .61 on the row and in the total", async () => {
		const { service } = setup(
			[
				{ currency: "ARS", type: "blue", rate: 1545, date: RATE_DATE },
				{ currency: "BTC", type: "crypto", rate: 60000, date: RATE_DATE },
			],
			[
				asset({
					id: "btc",
					currency: "BTC",
					balance: "0.01234567",
					type: "CRYPTO",
				}),
			],
		);

		const s = await service.getDashboardSummary("u", "ARS");

		expect(s.assets[0]?.balanceInTargetCurrency).toBe(1_144_443.61);
		expect(s.totalNetWorth).toBe(1_144_443.61);
		expect(s.assets[0]?.balanceInUSD).toBe(740.74);
	});
});

describe("the dashboard and homeValue agree exactly", () => {
	// A seeded generator, so a failure names its inputs.
	let state = 4_242_424;
	const next = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	const currencies = ["USD", "ARS", "JPY", "EUR", "BRL", "KWD", "BTC", "ETH"];
	const oneOf = () =>
		currencies[Math.floor(next() * currencies.length)] ?? "USD";

	it("holds for random fiat and crypto rates, balances and homes", async () => {
		for (let run = 0; run < 150; run++) {
			const rates: TestRateRow[] = currencies
				.filter((c) => c !== "USD")
				.map((c) =>
					isCrypto(c)
						? {
								currency: c,
								type: "crypto",
								rate: Math.round((1 + next() * 90000) * 100) / 100,
								date: RATE_DATE,
							}
						: official(c, Math.round((0.2 + next() * 1600) * 10000) / 10000),
				);
			const accounts = Array.from({ length: 4 }, (_, i) => {
				const currency = oneOf();
				return asset({
					id: `a${i}`,
					currency,
					type: isCrypto(currency) ? "CRYPTO" : "CASH",
					balance: (next() * 20000 - 5000).toFixed(isCrypto(currency) ? 8 : 4),
				});
			});
			const home = oneOf();
			const { service } = setup(rates, accounts);

			const s = await service.getDashboardSummary("u", home);

			const pick = ratePickFromRows([official("USD", 1), ...rates]);
			let sum = dec(0);
			for (const a of accounts) {
				const exact = homeValue(
					pick,
					{ currency: a.currency, rateType: null, storedRate: null },
					dec(a.balance),
					home,
					new Date(),
				);
				expect(exact).not.toBeNull();
				if (!exact) continue;
				sum = sum.plus(exact);
				expect(
					s.assets.find((r) => r.id === a.id)?.balanceInTargetCurrency,
				).toBe(roundedMajor(exact, home));
			}
			expect(s.totalAssets).toBe(roundedMajor(sum, home));
			expect(s.totalNetWorth).toBe(roundedMajor(sum, home));
		}
	});
});

describe("history with an account no rate can value", () => {
	const rates: TestRateRow[] = [
		{ currency: "ARS", type: "blue", rate: 1545, date: RATE_DATE },
	];
	const day = new Date("2026-10-01T00:00:00Z");
	const snapshot = (overrides: Record<string, unknown>) => ({
		accountId: "odd",
		date: day,
		recordedAt: day,
		balance: "100",
		balanceInUSD: "10",
		currency: "XYZ",
		type: "CASH",
		exchangeRateType: null,
		...overrides,
	});
	const odd = asset({ id: "odd", currency: "XYZ", balance: "100" });
	const point = (
		s: Awaited<ReturnType<WealthService["getDashboardSummary"]>>,
		date = "2026-10-01",
	) => s.history.find((h) => h.date === date);
	const gap = (date: string) => ({
		date,
		amount: null,
		assets: null,
		liabilities: null,
	});

	it("a recorded USD value still prices the day: USD 10 x 1,545 = ARS 15,450", async () => {
		const { db, service } = setup(rates, [odd]);
		db.assetSnapshot.findMany.mockResolvedValue([snapshot({})]);

		const s = await service.getDashboardSummary("u", "ARS");

		expect(point(s)?.amount).toBe(15_450);
		// Today it has no rate: left out and named, as before.
		expect(s.missingRateCurrencies).toEqual(["XYZ"]);
	});

	it("a legacy snapshot with no USD value is a gap, never 0", async () => {
		const { db, service } = setup(rates, [odd]);
		db.assetSnapshot.findMany.mockResolvedValue([
			snapshot({ balanceInUSD: null }),
		]);

		const s = await service.getDashboardSummary("u", "ARS");

		expect(point(s)).toEqual(gap("2026-10-01"));
		expect(s.missingRateCurrencies).toEqual(["XYZ"]);
	});

	it("legs on top of a zero snapshot with no rate are a gap, not the recorded 0", async () => {
		const { db, service } = setup(rates, [odd]);
		db.assetSnapshot.findMany.mockResolvedValue([
			snapshot({ balance: "0", balanceInUSD: "0" }),
		]);
		const later = new Date("2026-10-05T00:00:00Z");
		Object.assign(db, {
			accountLeg: {
				findMany: vi
					.fn()
					.mockResolvedValue([
						{ accountId: "odd", amount: "5", date: later, createdAt: later },
					]),
			},
		});

		const s = await service.getDashboardSummary("u", "ARS");

		// The snapshot day holds nothing, which is exactly 0; the leg's day has 5 XYZ.
		expect(point(s)?.amount).toBe(0);
		expect(point(s, "2026-10-05")).toEqual(gap("2026-10-05"));
		expect(s.missingRateCurrencies).toEqual(["XYZ"]);
	});

	it("a gap gives no 30-day baseline instead of a wrong one", async () => {
		const { db, service } = setup(rates, [odd]);
		const old = new Date();
		old.setDate(old.getDate() - 40);
		db.assetSnapshot.findMany.mockResolvedValue([
			snapshot({ date: old, recordedAt: old, balanceInUSD: null }),
		]);

		const s = await service.getDashboardSummary("u", "ARS");

		expect(s.netWorth30DaysAgo).toBeNull();
	});
});

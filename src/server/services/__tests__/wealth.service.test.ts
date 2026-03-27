import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { WealthService } from "../wealth.service";

// WealthService constructor takes a db, but calculateBalanceInUSD is purely synchronous
// and does not access the db. Pass an empty object cast to avoid spinning up Prisma.
const svc = new WealthService({} as never);

describe("WealthService.calculateBalanceInUSD", () => {
	describe("crypto currencies (amount * rate)", () => {
		it("BTC: 0.5 BTC @ 50000 USD/BTC → 25000 USD", () => {
			expect(svc.calculateBalanceInUSD(0.5, 50000, "BTC")).toBe(25000);
		});

		it("ETH: 2 ETH @ 3000 USD/ETH → 6000 USD", () => {
			expect(svc.calculateBalanceInUSD(2, 3000, "ETH")).toBe(6000);
		});

		it("low-price crypto (DOGE): 1000 DOGE @ 0.08 USD/DOGE → 80 USD", () => {
			expect(svc.calculateBalanceInUSD(1000, 0.08, "DOGE")).toBeCloseTo(80);
		});

		it("crypto with very small rate is NOT auto-inverted (uses multiply path)", () => {
			// DOGE at 0.001 USD - crypto goes through `balance * rate`, not the fiat branch
			expect(svc.calculateBalanceInUSD(10000, 0.001, "DOGE")).toBeCloseTo(10);
		});
	});

	describe("fiat currencies (balance / rate)", () => {
		it("ARS: 5000 ARS @ 1415 ARS/USD → ~3.534 USD", () => {
			expect(svc.calculateBalanceInUSD(5000, 1415, "ARS")).toBeCloseTo(3.534, 3);
		});

		it("EUR: 1000 EUR @ 0.92 EUR/USD → ~1087 USD", () => {
			expect(svc.calculateBalanceInUSD(1000, 0.92, "EUR")).toBeCloseTo(1087, 0);
		});

		it("USD passthrough: 100 USD @ rate 1 → 100 USD", () => {
			// BASE_CURRENCY skips the strong-currency and sanity checks
			expect(svc.calculateBalanceInUSD(100, 1, "USD")).toBeCloseTo(100);
		});
	});

	describe("auto-inversion for weak currencies with inverted rates", () => {
		it("ARS stored inverted (0.0007 instead of ~1430) is auto-corrected", () => {
			// effectiveRate = 1 / 0.0007 ≈ 1428.57; result = 5000 / 1428.57 ≈ 3.5
			const result = svc.calculateBalanceInUSD(5000, 0.0007, "ARS");
			expect(result).toBeCloseTo(3.5, 1);
		});

		it("auto-inversion does NOT apply to strong currencies", () => {
			// KWD rate = 0.30 (< 0.1 is false for 0.30, so no auto-inversion anyway)
			// The key: isStrongCurrency = true skips both the inversion AND the sanity check
			const result = svc.calculateBalanceInUSD(100, 0.3, "KWD");
			expect(result).toBeCloseTo(333, 0);
		});
	});

	describe("strong currencies (GBP, EUR, KWD, BHD, OMR, JOD)", () => {
		it("GBP: 1000 GBP @ 0.79 → ~1266 USD, no sanity throw", () => {
			// 1266 < 1000 * 1.5 = 1500, so no throw even without exception
			expect(svc.calculateBalanceInUSD(1000, 0.79, "GBP")).toBeCloseTo(1266, 0);
		});

		it("KWD: 100 KWD @ 0.3 → ~333 USD, sanity check skipped due to isStrongCurrency", () => {
			// 333 > 100 * 1.5 = 150 would fire the sanity check, but KWD is in the strong list
			expect(svc.calculateBalanceInUSD(100, 0.3, "KWD")).toBeCloseTo(333, 0);
		});

		it("all 6 strong currencies bypass the sanity check", () => {
			const strongCurrencies = ["GBP", "EUR", "KWD", "BHD", "OMR", "JOD"];
			for (const currency of strongCurrencies) {
				// Use a rate that would fire the sanity check for a non-strong currency
				expect(() => svc.calculateBalanceInUSD(100, 0.3, currency)).not.toThrow();
			}
		});
	});

	describe("sanity check (Billion Dollar bug prevention)", () => {
		it("throws for non-strong fiat when balanceInUSD > balance * 1.5", () => {
			// CHF is a valid fiat currency but NOT in the strong list
			// Rate 0.5 → balanceInUSD = 1000 / 0.5 = 2000; 2000 > 1000 * 1.5 = 1500 → throws
			expect(() => svc.calculateBalanceInUSD(1000, 0.5, "CHF")).toThrow(TRPCError);
		});

		it("sanity check does NOT fire when balanceInUSD ≤ balance * 1.5", () => {
			// ARS @ 1415: 5000 / 1415 ≈ 3.53; 3.53 < 5000 * 1.5 → no throw
			expect(() => svc.calculateBalanceInUSD(5000, 1415, "ARS")).not.toThrow();
		});

		it("sanity check does NOT fire for USD (base currency exempt)", () => {
			// Even with a bad rate, USD skips the sanity check entirely
			expect(() => svc.calculateBalanceInUSD(1000, 0.5, "USD")).not.toThrow();
		});
	});

	describe("invalid rates", () => {
		it("throws TRPCError for zero rate", () => {
			expect(() => svc.calculateBalanceInUSD(100, 0, "EUR")).toThrow(TRPCError);
		});

		it("throws TRPCError for negative rate", () => {
			expect(() => svc.calculateBalanceInUSD(100, -1, "EUR")).toThrow(TRPCError);
		});
	});
});

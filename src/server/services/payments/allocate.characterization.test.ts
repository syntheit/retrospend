/**
 * Today's settle dialog numbers next to allocatePayment's. Each scenario
 * pins what the old allocator (settlement-allocation.ts: smallest debt
 * first, offsets in one currency) wrote, then what allocatePayment writes.
 * A difference is always one of the owner-decided rules (MONEY-MOVES §1.2):
 * same currency first, oldest first, offsets across currencies.
 */
import { describe, expect, it } from "vitest";
import {
	allocateAcrossScopes,
	allocateFullSettlement,
} from "~/server/services/shared-expenses/settlement-allocation";
import { allocatePayment, quote } from "./allocate";
import type { PairLine } from "./types";

const line = (
	scope: string | null,
	currency: string,
	owed: number,
	oldest: string,
): PairLine => ({ scope, currency, owed, oldest });

const NO_QUOTES = new Map();

describe("settle dialog, today vs allocatePayment", () => {
	it("partial payment in one currency: today smallest first, now oldest first (changed)", () => {
		// Direct USD 5 (Oct 9), A USD 10 (Oct 1), B USD 30 (Oct 5); pay USD 12.
		const today = allocateAcrossScopes(
			[
				{ projectId: null, owed: 5 },
				{ projectId: "A", owed: 10 },
				{ projectId: "B", owed: 30 },
			],
			12,
		);
		expect(today).toEqual([
			{ projectId: null, amount: 5 },
			{ projectId: "A", amount: 7 },
		]);

		const now = allocatePayment({
			lines: [
				line(null, "USD", 500, "2026-10-09"),
				line("A", "USD", 1000, "2026-10-01"),
				line("B", "USD", 3000, "2026-10-05"),
			],
			currency: "USD",
			amount: 1200,
			quotes: NO_QUOTES,
		});
		expect(now.rows.map((r) => [r.scope, r.amount, r.paid])).toEqual([
			["A", 1000, 1000],
			["B", 200, 200],
		]);
		expect(now.offsets).toEqual([]);
	});

	it("full payment with a debt the other way, one currency: same rows as today", () => {
		// Payer owes Trip USD 50, is owed Rent USD 30; pays the net USD 20.
		const today = allocateFullSettlement(
			[{ projectId: "Trip", owed: 50 }],
			[{ projectId: "Rent", owed: 30 }],
			20,
		);
		expect(today).toEqual({
			cash: [{ projectId: "Trip", amount: 20 }],
			payerOffsets: [{ projectId: "Trip", amount: 30 }],
			payeeOffsets: [{ projectId: "Rent", amount: 30 }],
		});

		const now = allocatePayment({
			lines: [
				line("Trip", "USD", 5000, "2026-10-01"),
				line("Rent", "USD", -3000, "2026-10-03"),
			],
			currency: "USD",
			amount: 2000,
			quotes: NO_QUOTES,
		});
		expect(now.everything).toBe(true);
		expect(now.rows.map((r) => [r.scope, r.amount])).toEqual([["Trip", 2000]]);
		expect(now.offsets.map((o) => [o.scope, o.from, o.amount])).toEqual([
			["Rent", "payee", 3000],
			["Trip", "payer", 3000],
		]);
	});

	it("settle all in USD with a EUR debt: same total and rows as today", () => {
		// Today's settleAll: USD 20 as is, EUR 30 at 3 EUR per USD = USD 10.
		const now = allocatePayment({
			lines: [
				line(null, "USD", 2000, "2026-10-02"),
				line("A", "EUR", 3000, "2026-10-01"),
			],
			currency: "USD",
			amount: null,
			quotes: new Map([
				["EUR", quote("0.3333333333333333333333333333", "official")],
			]),
		});
		expect(now.amount).toBe(3000);
		expect(
			now.rows.map((r) => [r.scope, r.currency, r.amount, r.paid]),
		).toEqual([
			[null, "USD", 2000, 2000],
			["A", "EUR", 3000, 1000],
		]);
	});

	it("settle all when another currency is owed back: today left it, now nets it with a cross-currency offset (changed)", () => {
		// Payer owes USD 20 outside projects, is owed EUR 30 in A (= USD 10).
		// Today's settleAll paid USD 20 and left EUR alone; now Everything pays
		// the USD 10 net and offsets EUR 30 against USD 10.
		const now = allocatePayment({
			lines: [
				line(null, "USD", 2000, "2026-10-02"),
				line("A", "EUR", -3000, "2026-10-01"),
			],
			currency: "USD",
			amount: null,
			quotes: new Map([
				["EUR", quote("0.3333333333333333333333333333", "official")],
			]),
		});
		expect(now.amount).toBe(1000);
		expect(now.rows.map((r) => [r.scope, r.currency, r.amount])).toEqual([
			[null, "USD", 1000],
		]);
		expect(
			now.offsets.map((o) => [o.scope, o.currency, o.from, o.amount, o.value]),
		).toEqual([
			["A", "EUR", "payee", 3000, 1000],
			[null, "USD", "payer", 1000, 1000],
		]);
	});

	it("a single-currency payment above that currency's debts: today refused, now converts the rest (changed)", () => {
		// Owes USD 10 and EUR 30 (USD 10 at 3 per USD); pays USD 15.
		const now = allocatePayment({
			lines: [
				line(null, "USD", 1000, "2026-10-05"),
				line("A", "EUR", 3000, "2026-10-01"),
			],
			currency: "USD",
			amount: 1500,
			quotes: new Map([
				["EUR", quote("0.3333333333333333333333333333", "official")],
			]),
		});
		expect(now.rows.map((r) => [r.currency, r.amount, r.paid])).toEqual([
			["USD", 1000, 1000],
			["EUR", 1500, 500],
		]);
		expect(now.overpay).toBe(0);
	});

	it("a cent over what is owed: today dropped up to 0.01, now it is an overpayment unless dust (changed)", () => {
		const usd = allocatePayment({
			lines: [line(null, "USD", 1000, "2026-10-05")],
			currency: "USD",
			amount: 1001,
			quotes: NO_QUOTES,
		});
		expect(usd.overpay).toBe(1);
		// ARS is shown whole, so up to ARS 0.99 over is dust.
		const ars = allocatePayment({
			lines: [line(null, "ARS", 1_800_000, "2026-10-05")],
			currency: "ARS",
			amount: 1_800_099,
			quotes: NO_QUOTES,
		});
		expect(ars.overpay).toBe(0);
		expect(ars.rows).toEqual([
			expect.objectContaining({ amount: 1_800_000, paid: 1_800_099 }),
		]);
	});
});

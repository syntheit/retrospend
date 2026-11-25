/**
 * The posted row, against what the server books today (the characterization
 * tests' base case: home ARS, preferred USD type blue, USD 20 template due
 * 2026-12-01T03:00Z). Every expected value is derived by hand.
 *   blue 1,545 (Nov 30): USD 20 * 1,545 = ARS 30,900.00
 *   official 1,050 (Dec 1): USD 20 * 1,050 = ARS 21,000.00
 *   ask-me USD 18.50: 18.5 * 1,545 = 27,810 + 772.5 = ARS 28,582.50
 *   paid Nov 29 at blue 1,540: 20 * 1,540 = 30,800.00; Nov 1 at 1,500: 30,000.00
 *   EUR home, USD 20 at 0.92 EUR per USD: 18.40
 *   JPY home, USD 8.35 at 150: 1,252.5, a tie: half to even is 1,252 (half up
 *   would give 1,253)
 */
import { describe, expect, it } from "vitest";
import { MissingRateError } from "../money";
import { recurringEntryRow } from "./entry-row";
import { RecurringInputRefusal } from "./refusals";
import { BASE_TEMPLATE, ba, baseStore, rate } from "./test-kit";

describe("recurringEntryRow", () => {
	it("books USD 20 at blue 1,545 as ARS 30,900.00, the server's row field for field", async () => {
		const row = await recurringEntryRow(BASE_TEMPLATE, {}, baseStore().book);
		expect(row).toEqual({
			userId: "me",
			amount: "20",
			currency: "USD",
			date: ba("2026-12-01"),
			categoryId: null,
			exchangeRate: "1",
			amountInUSD: "20.00",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1545",
			homeAmount: "30900.00",
			pricingSource: "RECURRING",
			recurringTemplateId: "t1",
			status: "FINALIZED",
			direction: "OUT",
			inType: null,
			excludeFromAnalytics: false,
		});
	});

	it("never carries a title: the adapter adds it from its own store", async () => {
		const row = await recurringEntryRow(BASE_TEMPLATE, {}, baseStore().book);
		expect("title" in row).toBe(false);
	});

	it("a user who prefers official gets ARS 21,000.00", async () => {
		const book = baseStore({ preferred: { ARS: "official" } }).book;
		const row = await recurringEntryRow(BASE_TEMPLATE, {}, book);
		expect([row.rateType, row.homeRate, row.homeAmount]).toEqual([
			"official",
			"1050",
			"21000.00",
		]);
	});

	it("an excludeByDefault category does not reach the row: excludeFromAnalytics stays false", async () => {
		// The category is not an input: only its id is (the expense form applies
		// excludeByDefault, a recurring post never has).
		const row = await recurringEntryRow(
			{ ...BASE_TEMPLATE, categoryId: "cat-excluded-by-default" },
			{},
			baseStore().book,
		);
		expect(row.categoryId).toBe("cat-excluded-by-default");
		expect(row.excludeFromAnalytics).toBe(false);
	});

	it("an ask-me template books the typed amount: USD 18.50 is ARS 28,582.50", async () => {
		const row = await recurringEntryRow(
			{ ...BASE_TEMPLATE, amountMode: "ASK" },
			{ confirmedAmount: "18.50" },
			baseStore().book,
		);
		expect([row.amount, row.amountInUSD, row.homeAmount]).toEqual([
			"18.5",
			"18.50",
			"28582.50",
		]);
	});

	it("paid on another day books that day's rate and date", async () => {
		const book = baseStore().book;
		const nov29 = await recurringEntryRow(
			BASE_TEMPLATE,
			{ paidOn: ba("2026-11-29") },
			book,
		);
		expect([nov29.date, nov29.homeRate, nov29.homeAmount]).toEqual([
			ba("2026-11-29"),
			"1540",
			"30800.00",
		]);
		const nov1 = await recurringEntryRow(
			BASE_TEMPLATE,
			{ paidOn: ba("2026-11-01") },
			book,
		);
		expect([nov1.homeRate, nov1.homeAmount]).toEqual(["1500", "30000.00"]);
	});

	it("money in is income: direction IN and inType INCOME", async () => {
		const row = await recurringEntryRow(
			{ ...BASE_TEMPLATE, direction: "IN" },
			{},
			baseStore().book,
		);
		expect([row.direction, row.inType]).toEqual(["IN", "INCOME"]);
	});

	it("an ask-me template with no amount is refused", async () => {
		await expect(
			recurringEntryRow(
				{ ...BASE_TEMPLATE, amountMode: "ASK" },
				{},
				baseStore().book,
			),
		).rejects.toMatchObject({
			constructor: RecurringInputRefusal,
			kind: "amount_required",
			message: "Confirm the amount for this recurring entry",
		});
	});

	it("a fixed template given an amount is refused", async () => {
		await expect(
			recurringEntryRow(
				BASE_TEMPLATE,
				{ confirmedAmount: "18.50" },
				baseStore().book,
			),
		).rejects.toMatchObject({
			constructor: RecurringInputRefusal,
			kind: "amount_fixed",
			message: "This recurring amount is fixed",
		});
	});

	it("a currency with no rate throws MissingRateError, never books at 1", async () => {
		await expect(
			recurringEntryRow(
				{ ...BASE_TEMPLATE, currency: "COP" },
				{},
				baseStore().book,
			),
		).rejects.toBeInstanceOf(MissingRateError);
	});

	it("EUR home: USD 20 at 0.92 books EUR 18.40", async () => {
		const book = baseStore({
			homeCurrency: "EUR",
			preferred: {},
			rates: [rate("2026-11-01", "EUR", "official", 0.92)],
		}).book;
		const row = await recurringEntryRow(BASE_TEMPLATE, {}, book);
		expect([row.homeCurrency, row.homeAmount]).toEqual(["EUR", "18.40"]);
	});

	it("JPY home: USD 8.35 at 150 books JPY 1,252, the tie going to the even digit", async () => {
		const book = baseStore({
			homeCurrency: "JPY",
			preferred: {},
			rates: [rate("2026-11-01", "JPY", "official", 150)],
		}).book;
		const row = await recurringEntryRow(
			{ ...BASE_TEMPLATE, amount: "8.35" },
			{},
			book,
		);
		expect(row.homeAmount).toBe("1252");
	});
});

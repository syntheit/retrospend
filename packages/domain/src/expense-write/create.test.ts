import { describe, expect, it } from "vitest";
import { MissingRateError } from "../money";
import type { BookContext } from "../rate-booking";
import { bookCreate, planCreate } from "./create";
import { AMOUNT_ABOVE_ZERO, AmountRefusedError } from "./refusals";

const DATE = new Date("2026-03-05T15:00:00Z");

/** One rate per currency (units per USD) and its type; a currency not listed has none. */
const table = (
	rates: Record<string, { rate: number; type: string }>,
	home: string,
	preferred: string | null = null,
): BookContext => ({
	homeCurrency: home,
	preferred,
	find: async (currency, date) => {
		const hit = rates[currency];
		return hit ? { ...hit, date, onOrBefore: true } : null;
	},
});

const create = (
	ctx: BookContext,
	amount: string,
	currency: string,
	more: object = {},
) =>
	bookCreate(ctx, { amount, currency, date: DATE, ...more }).then(
		(r) => r.booked,
	);

describe("planCreate", () => {
	it("stores the amount at 8 decimals, half to even", () => {
		// 1.000000005 is a tie at the 8th decimal: 0 is even, so 1.00000000 (half up gives ...01).
		expect(planCreate({ amount: "1.000000005" }).amount).toBe("1");
		expect(planCreate({ amount: "1.000000015" }).amount).toBe("1.00000002");
	});

	it.each([
		["zero", "0"],
		["a negative amount", "-5"],
		["an amount that stores as 0 at 8 decimals", "0.000000004"],
		["a tie that stores as 0 (half to even)", "0.000000005"],
		["not a number", "abc"],
	])("amount above 0: %s is refused", (_what, amount) => {
		expect(() => planCreate({ amount })).toThrow(AmountRefusedError);
		expect(() => planCreate({ amount })).toThrow(AMOUNT_ABOVE_ZERO);
	});

	it("accepts the smallest storable amount", () => {
		expect(planCreate({ amount: "0.00000001" }).amount).toBe("0.00000001");
		expect(planCreate({ amount: 0.5 }).amount).toBe("0.5");
	});

	it("excludeFromAnalytics: a project wins, then the form, then the category default, then false", () => {
		const hold = { id: "c", kind: "EXPENSE", excludeByDefault: true };
		const plan = (over: object, category?: typeof hold) =>
			planCreate({ amount: "1", ...over }, category).excludeFromAnalytics;
		expect(plan({ projectId: "p", excludeFromAnalytics: true }, hold)).toBe(
			false,
		);
		expect(plan({ excludeFromAnalytics: false }, hold)).toBe(false);
		expect(plan({ excludeFromAnalytics: true })).toBe(true);
		expect(plan({}, hold)).toBe(true);
		expect(plan({}, { ...hold, excludeByDefault: false })).toBe(false);
		expect(plan({})).toBe(false);
	});
});

describe("bookCreate", () => {
	const ars = table({ ARS: { rate: 1545, type: "blue" } }, "ARS", "blue");

	it("ARS home at blue 1545: USD 100, 120 are 154500.00 and 185400.00", async () => {
		expect((await create(ars, "100", "USD")).homeAmount).toBe("154500.00");
		expect((await create(ars, "120", "USD")).homeAmount).toBe("185400.00");
	});

	it("ARS home at blue 1545: USD 10, 20 and 30.01 are 15450.00, 30900.00 and 46365.45", async () => {
		const homes = [
			(await create(ars, "10", "USD")).homeAmount,
			(await create(ars, "20", "USD")).homeAmount,
			(await create(ars, "30.01", "USD")).homeAmount,
		];
		expect(homes).toEqual(["15450.00", "30900.00", "46365.45"]);
	});

	it("EUR home: USD 100 at 0.92 books EUR 92.00", async () => {
		const eur = table({ EUR: { rate: 0.92, type: "official" } }, "EUR");
		expect(await create(eur, "100", "USD")).toMatchObject({
			homeCurrency: "EUR",
			homeRate: "0.92",
			homeAmount: "92.00",
			amountInUSD: "100.00",
		});
	});

	it("JPY home ties: 1252.5 books 1252, 1257.5 books 1258 (half up gives 1253)", async () => {
		const jpy = table({ JPY: { rate: 125, type: "official" } }, "JPY");
		expect((await create(jpy, "10.02", "USD")).homeAmount).toBe("1252");
		expect((await create(jpy, "10.06", "USD")).homeAmount).toBe("1258");
	});

	it("KWD home: 2.5025 books 2.502", async () => {
		const kwd = table({ KWD: { rate: 0.25, type: "official" } }, "KWD");
		expect((await create(kwd, "10.01", "USD")).homeAmount).toBe("2.502");
	});

	it("CLP with no rate throws MissingRateError, never 1", async () => {
		await expect(create(ars, "10", "CLP")).rejects.toBeInstanceOf(
			MissingRateError,
		);
		await expect(create(ars, "10", "CLP")).rejects.toMatchObject({
			currencies: ["CLP"],
		});
		const usd = table({}, "USD");
		await expect(create(usd, "10", "CLP")).rejects.toBeInstanceOf(
			MissingRateError,
		);
	});

	it("refuses an amount of 0 before it looks for a rate", async () => {
		await expect(create(ars, "0", "CLP")).rejects.toBeInstanceOf(
			AmountRefusedError,
		);
	});

	it("books the stored amount, not the typed one", async () => {
		const { plan, booked } = await bookCreate(table({}, "USD"), {
			amount: "1.000000005",
			currency: "USD",
			date: DATE,
		});
		expect(plan.amount).toBe("1");
		expect(booked.homeAmount).toBe("1.00");
	});
});

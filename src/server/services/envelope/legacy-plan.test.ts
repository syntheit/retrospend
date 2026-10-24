/**
 * Legacy budgets to Limits (legacy-plan.ts), expected values by hand. USD
 * book, cents. Categories: Rent (fixed, group Bills), Groceries, Dining,
 * Transport, Fun, and Gifts (never budgeted).
 *
 *   Rent 1,200.00 FIXED, Groceries 400.00 FIXED, Dining pegged to actual
 *   (87.50 spent so far), Transport pegged to last month (65.00 last
 *   month), Fun ARS 200,000.00 FIXED at 1,000 ARS per USD (200.00),
 *   global 3,000.00.
 *
 *   Everything else = 3,000.00 - (1,200.00 + 400.00 + 65.00 + 200.00)
 *                   = 1,135.00; Dining is not part of the sum (no limit).
 *   Old total: global 3,000.00 + pegged-to-actual spending 87.50 = 3,087.50.
 *   Funded now: 1,200 + 400 + 87.50 + 65 + 200 + 1,135 = 3,087.50.
 */
import { describe, expect, it } from "vitest";
import {
	type LegacyBudgetRow,
	type LegacyCategory,
	type LegacyPlanInput,
	planLegacyMigration,
} from "./legacy-plan";

const cat = (id: string, name: string, isFixed = false): LegacyCategory => ({
	id,
	name,
	icon: null,
	color: "blue",
	isFixed,
});

const categories = [
	cat("rent", "Rent", true),
	cat("groc", "Groceries"),
	cat("dine", "Dining"),
	cat("tran", "Transport"),
	cat("fun", "Fun"),
	cat("gift", "Gifts"),
];

const row = (r: Partial<LegacyBudgetRow>): LegacyBudgetRow => ({
	categoryId: null,
	amount: "0",
	currency: "USD",
	type: "FIXED",
	pegToActual: false,
	isRollover: false,
	rolloverAmount: "0",
	...r,
});

/** 1,000 ARS per USD; any other foreign currency has no rate. */
const convert: LegacyPlanInput["convert"] = (amount, currency) => {
	if (currency === "USD") return Math.round(Number(amount) * 100);
	if (currency === "ARS") return Math.round(Number(amount) / 10);
	return null;
};

const base: LegacyPlanInput = {
	currency: "USD",
	budgets: [
		row({ categoryId: "rent", amount: "1200.00" }),
		row({ categoryId: "groc", amount: "400.00" }),
		row({ categoryId: "dine", type: "PEG_TO_ACTUAL" }),
		row({ categoryId: "tran", type: "PEG_TO_LAST_MONTH" }),
		row({ categoryId: "fun", amount: "200000.00", currency: "ARS" }),
		row({ amount: "3000.00" }),
	],
	categories,
	convert,
	spentNow: new Map([
		["dine", 8_750],
		["groc", 12_000],
	]),
	spentLast: new Map([["tran", 6_500]]),
	spendingMissing: [],
};

function planOf(input: LegacyPlanInput) {
	const r = planLegacyMigration(input);
	if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`);
	return r.plan;
}

describe("planLegacyMigration", () => {
	it("maps five category budgets and a global one to Limits envelopes", () => {
		const plan = planOf(base);
		expect(plan.setup.style).toBe("LIMITS");
		expect(plan.setup.startingMoneyMinor).toBeUndefined();
		expect(plan.setup.groups).toEqual([
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "everyday", name: "Everyday", role: "SPENDING" },
		]);
		const byName = Object.fromEntries(
			plan.setup.envelopes.map((e) => [e.name, e]),
		);
		expect(Object.keys(byName).sort()).toEqual([
			"Dining",
			"Everything else",
			"Fun",
			"Groceries",
			"Rent",
			"Transport",
		]);
		expect(byName.Rent).toMatchObject({
			groupKey: "bills",
			kind: "MONTHLY",
			categoryIds: ["rent"],
			target: {
				kind: "MONTHLY",
				amountMinor: 120_000,
				mode: "SET_ASIDE",
				cadence: "MONTH",
			},
		});
		expect(byName.Rent?.target).not.toHaveProperty("currency");
		expect(byName.Groceries?.target).toMatchObject({ amountMinor: 40_000 });
		// Pegged to actual: no target, this month's activity is assigned.
		expect(byName.Dining).toMatchObject({ kind: "NONE", groupKey: "everyday" });
		expect(byName.Dining?.target).toBeUndefined();
		expect(byName.Transport?.target).toMatchObject({ amountMinor: 6_500 });
		// Another currency keeps its own currency and minor units (D25).
		expect(byName.Fun?.target).toMatchObject({
			amountMinor: 20_000_000,
			currency: "ARS",
		});
		expect(byName["Everything else"]).toMatchObject({
			isDefault: true,
			target: { amountMinor: 113_500 },
			// Gifts is the only category no budget names.
			categoryIds: ["gift"],
		});
	});

	it("funds 3,087.50 now, the old total, and counts each kind", () => {
		const plan = planOf(base);
		expect(plan.report).toMatchObject({
			fixed: 3,
			pegToActual: 1,
			pegToLastMonth: 1,
			global: true,
			beforeMinor: 308_750,
			plannedMinor: 308_750,
		});
		const funded = Object.fromEntries(
			plan.envelopes.map((e) => [e.name, e.fundMinor]),
		);
		expect(funded).toEqual({
			Rent: 120_000,
			Groceries: 40_000,
			Dining: 8_750,
			Transport: 6_500,
			Fun: 20_000,
			"Everything else": 113_500,
		});
		expect(plan.envelopes.find((e) => e.name === "Dining")?.pegged).toBe(true);
	});

	it("gives Everything else no limit when the category limits pass the global one", () => {
		const plan = planOf({
			...base,
			budgets: [
				row({ categoryId: "rent", amount: "1200.00" }),
				row({ amount: "1000.00" }),
			],
		});
		const other = plan.setup.envelopes.find((e) => e.isDefault);
		expect(other?.target).toBeUndefined();
		// The old budget said 1,000.00; the categories alone now fund 1,200.00.
		expect(plan.report.beforeMinor).toBe(100_000);
		expect(plan.report.plannedMinor).toBe(120_000);
	});

	it("with no global budget, Everything else has no target and holds the unlinked categories", () => {
		const plan = planOf({
			...base,
			budgets: [row({ categoryId: "groc", amount: "400.00" })],
		});
		const other = plan.setup.envelopes.find((e) => e.isDefault);
		expect(other?.target).toBeUndefined();
		expect(other?.categoryIds).toEqual(["rent", "dine", "tran", "fun", "gift"]);
		expect(plan.setup.groups.map((g) => g.key)).toEqual(["everyday"]);
		expect(plan.report.beforeMinor).toBe(40_000);
	});

	it("a global budget pegged to actual is funded with the spending outside the linked categories", () => {
		const plan = planOf({
			...base,
			budgets: [
				row({ categoryId: "groc", amount: "400.00" }),
				row({ type: "PEG_TO_ACTUAL" }),
			],
			spentNow: new Map<string | null, number>([
				["groc", 12_000],
				["dine", 8_750],
				[null, 1_250],
			]),
		});
		const other = plan.envelopes.find((e) => e.key === "else");
		// Dining 87.50 + no category 12.50; Groceries is linked.
		expect(other).toMatchObject({ pegged: true, fundMinor: 10_000 });
		expect(plan.setup.envelopes.find((e) => e.isDefault)).toMatchObject({
			kind: "NONE",
		});
	});

	it("adds an old rollover to the first funding, converted", () => {
		const plan = planOf({
			...base,
			budgets: [
				row({
					categoryId: "fun",
					amount: "200000.00",
					currency: "ARS",
					isRollover: true,
					rolloverAmount: "50000.00",
				}),
			],
		});
		expect(plan.envelopes.find((e) => e.name === "Fun")).toMatchObject({
			fundMinor: 20_000,
			rolloverMinor: 5_000,
		});
		expect(plan.report.plannedMinor).toBe(25_000);
	});

	it("lists a currency with no rate and refuses; it never values it at 1", () => {
		const r = planLegacyMigration({
			...base,
			budgets: [
				row({ categoryId: "rent", amount: "1200.00" }),
				row({ categoryId: "fun", amount: "150.00", currency: "EUR" }),
				row({ amount: "3000.00", currency: "BRL" }),
			],
		});
		expect(r).toEqual({
			ok: false,
			refusal: { reason: "MISSING_RATE", currencies: ["BRL", "EUR"] },
		});
	});

	it("spending rows the loader could not value refuse too", () => {
		const r = planLegacyMigration({ ...base, spendingMissing: ["CLP"] });
		expect(r).toEqual({
			ok: false,
			refusal: { reason: "MISSING_RATE", currencies: ["CLP"] },
		});
	});

	it("leaves out a budget whose category is not an expense category, and says so", () => {
		const plan = planOf({
			...base,
			budgets: [
				row({ categoryId: "groc", amount: "400.00" }),
				row({ categoryId: "salary", amount: "10.00" }),
			],
		});
		expect(plan.report.left).toEqual([
			{ categoryId: "salary", reason: "not an expense category" },
		]);
		expect(plan.setup.envelopes).toHaveLength(2);
	});

	it("nothing to migrate without a usable budget", () => {
		expect(planLegacyMigration({ ...base, budgets: [] })).toEqual({
			ok: false,
			refusal: { reason: "NOTHING_TO_MIGRATE" },
		});
		expect(
			planLegacyMigration({
				...base,
				budgets: [row({ amount: "0" })],
			}),
		).toEqual({ ok: false, refusal: { reason: "NOTHING_TO_MIGRATE" } });
	});
});

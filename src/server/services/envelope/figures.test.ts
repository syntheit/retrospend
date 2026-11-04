/**
 * The budget figures pick numbers out of what BudgetReads returns, so any
 * store that answers the reads (Postgres, a device) gets the same figures.
 * A fake store here, ARS book: expected values by hand.
 */
import { describe, expect, it } from "vitest";
import type { FigureScope } from "~/server/figures/registry";
import { type BudgetReads, createBudgetFigures } from "./figures";
import type { MonthRead } from "./month-read";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const env = (id: string, left: number, weekly?: number) => ({
	id,
	left: ars(left),
	spent: ars(left / 2),
	leftThisWeek: weekly === undefined ? null : { amount: ars(weekly) },
});

const view = {
	dto: {
		book: { currency: "ARS" },
		toAssign: { amount: ars(70_000_000), terms: { moneyIn: ars(100_000_000) } },
		leftToSpend: { left: ars(12_345_678) },
		owed: { held: ars(0) },
		verdict: { lead: null },
		groups: [
			{
				envelopes: [
					env("a", 1_000_000, 100_050),
					env("b", 500_000, 25_025),
					env("c", 250_000),
				],
			},
		],
	},
} as unknown as MonthRead;

const reads = (month: MonthRead | null): BudgetReads<null> => ({
	month: async () => month,
	plan: async () => null,
	debt: async () => null,
});
const scope = (envelopeId?: string) =>
	({ userId: "u", envelopeId }) as FigureScope;
const figure = (id: string, month: MonthRead | null) => {
	const f = createBudgetFigures(reads(month)).find((d) => d.id === id);
	if (!f) throw new Error(id);
	return f;
};

describe("budget figures over a fake store", () => {
	it("pick the month's numbers", async () => {
		expect(
			await figure("budget.notPlannedYet", view).compute(null, scope()),
		).toEqual(ars(70_000_000));
		expect(await figure("budget.moneyIn", view).compute(null, scope())).toEqual(
			ars(100_000_000),
		);
		expect(
			await figure("envelope.left", view).compute(null, scope("b")),
		).toEqual(ars(500_000));
		expect(
			await figure("envelope.spent", view).compute(null, scope("b")),
		).toEqual(ars(250_000));
	});

	it("sums this week over the weekly envelopes only: 1,000.50 + 250.25 = 1,250.75", async () => {
		expect(
			await figure("budget.leftThisWeek", view).compute(null, scope()),
		).toEqual(ars(125_075));
	});

	it("are unavailable without a month, never zero", async () => {
		for (const id of [
			"budget.notPlannedYet",
			"budget.moneyIn",
			"budget.leftToSpend",
			"budget.leftThisWeek",
			"budget.heldForOthers",
		])
			expect(await figure(id, null).compute(null, scope())).toBeNull();
		expect(
			await figure("envelope.left", null).compute(null, scope("a")),
		).toBeNull();
		expect(
			await figure("budget.planCost", view).compute(null, scope()),
		).toBeNull();
		expect(
			await figure("budget.totalDebt", view).compute(null, scope()),
		).toBeNull();
	});

	it("an envelope figure without an envelope is unavailable", async () => {
		expect(
			await figure("envelope.left", view).compute(null, scope()),
		).toBeNull();
	});
});

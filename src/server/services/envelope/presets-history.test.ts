import { describe, expect, it } from "vitest";
import { stylePreset } from "./presets";

const templates = [
	{
		id: "t-rent",
		name: "Rent",
		categoryId: "c-housing",
		frequency: "MONTHLY" as const,
	},
];
const categories = [
	{ id: "c-housing", name: "Housing", isFixed: true },
	{ id: "c-insurance", name: "Insurance", isFixed: true },
	{ id: "c-groceries", name: "Groceries", isFixed: false },
	{ id: "c-dining", name: "Dining", isFixed: false },
];

// Rent (c-housing) is a bill; Groceries 90,000 and Dining 30,000 minor over the 3 months.
const spent = new Map([
	["c-housing", 300_000],
	["c-groceries", 90_000],
	["c-dining", 30_000],
]);

const at = (
	style: "FLEX" | "EVERY_DOLLAR" | "DEBT_PAYOFF",
	s: ReadonlyMap<string, number> = spent,
) =>
	stylePreset({
		style,
		currency: "ARS",
		templates,
		categories,
		spent: s,
		unit: 100,
	}).envelopes;

const spendingTarget = (
	style: "FLEX" | "DEBT_PAYOFF",
	s?: ReadonlyMap<string, number>,
) => at(style, s).find((e) => e.key === "spending")?.target;

describe("Flex and Every dollar start from the last 3 months", () => {
	it("Flex: Spending is the monthly average of what no bill covers, as a Refill target", () => {
		// (90,000 + 30,000) / 3 = 40,000; the 300,000 on Rent belongs to its bill.
		const refill = {
			kind: "MONTHLY",
			amountMinor: 40_000,
			mode: "REFILL",
			cadence: "MONTH",
		};
		expect(spendingTarget("FLEX")).toEqual(refill);
		expect(spendingTarget("DEBT_PAYOFF")).toEqual(refill);
	});

	it("Flex: rounds up to whole units", () => {
		// 100,001 / 3 = 33,333.67, so 334 whole units of 100 = 33,400.
		expect(
			spendingTarget("FLEX", new Map([["c-groceries", 100_001]])),
		).toMatchObject({ amountMinor: 33_400 });
	});

	it("no history proposes nothing: Spending keeps no target", () => {
		expect(spendingTarget("FLEX", new Map())).toBeNull();
		// Only the bill's category spent: nothing for Spending.
		expect(
			spendingTarget("FLEX", new Map([["c-housing", 300_000]])),
		).toBeNull();
	});

	it("Every dollar: each category with spending gets its own average, the rest stay empty", () => {
		const byKey = new Map(at("EVERY_DOLLAR").map((e) => [e.key, e.target]));
		expect(byKey.get("cat-c-groceries")).toMatchObject({ amountMinor: 30_000 });
		expect(byKey.get("cat-c-dining")).toMatchObject({ amountMinor: 10_000 });
		expect(byKey.get("cat-c-insurance")).toBeNull();
		expect(byKey.get("else")).toBeNull();
	});

	it("without a history read the preset is unchanged", () => {
		const plain = stylePreset({
			style: "FLEX",
			currency: "ARS",
			templates,
			categories,
		}).envelopes;
		expect(plain.find((e) => e.key === "spending")?.target).toBeNull();
	});
});

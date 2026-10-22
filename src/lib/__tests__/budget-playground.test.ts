import { describe, expect, it } from "vitest";
import {
	type PlaygroundBaseBudget,
	playgroundApplyPayload,
} from "~/lib/budget-playground";

const period = new Date(2026, 9, 1);

const groceries: PlaygroundBaseBudget = {
	category: { id: "groceries" },
	amount: 300_000,
	currency: "ARS",
	type: "FIXED",
	pegToActual: false,
	isRollover: true,
};
const travel: PlaygroundBaseBudget = {
	category: { id: "travel" },
	amount: 200,
	currency: "USD",
	type: "FIXED",
	pegToActual: false,
};
const dining: PlaygroundBaseBudget = {
	category: { id: "dining" },
	amount: 0,
	currency: "EUR",
	type: "PEG_TO_ACTUAL",
	pegToActual: true,
};
const utilities: PlaygroundBaseBudget = {
	category: { id: "utilities" },
	amount: 0,
	currency: "USD",
	type: "PEG_TO_LAST_MONTH",
	pegToActual: false,
};
const baseBudgets = [groceries, travel, dining, utilities];

/** The playground seeds each category with its budget's own amount. */
const seeded = {
	groceries: 300_000,
	travel: 200,
	dining: 0,
	utilities: 0,
};

function apply(simulatedBudgets: Record<string, number>) {
	return playgroundApplyPayload({
		baseBudgets,
		simulatedBudgets,
		homeCurrency: "ARS",
		period,
	});
}

describe("playgroundApplyPayload", () => {
	it("writes nothing when nothing changed", () => {
		// The old Apply rewrote every budget into ARS and reset the pegged ones
		// to FIXED with a 0 limit
		expect(apply(seeded)).toEqual([]);
	});

	it("keeps a changed budget's currency, type and rollover", () => {
		expect(apply({ ...seeded, travel: 250, groceries: 320_000 })).toEqual([
			{
				categoryId: "groceries",
				amount: 320_000,
				currency: "ARS",
				period,
				type: "FIXED",
				pegToActual: false,
				isRollover: true,
			},
			{
				categoryId: "travel",
				amount: 250,
				currency: "USD",
				period,
				type: "FIXED",
				pegToActual: false,
				isRollover: false,
			},
		]);
	});

	it("never turns a pegged budget into a FIXED one", () => {
		const payload = apply({ ...seeded, dining: 80, utilities: 40 });
		expect(payload).toHaveLength(2);
		expect(payload.find((p) => p.categoryId === "dining")).toMatchObject({
			currency: "EUR",
			type: "PEG_TO_ACTUAL",
			pegToActual: true,
		});
		expect(payload.find((p) => p.categoryId === "utilities")).toMatchObject({
			currency: "USD",
			type: "PEG_TO_LAST_MONTH",
			pegToActual: false,
		});
	});

	it("creates a FIXED home-currency budget for a newly funded category", () => {
		expect(apply({ ...seeded, gifts: 50_000, pets: 0 })).toEqual([
			{
				categoryId: "gifts",
				amount: 50_000,
				currency: "ARS",
				period,
				type: "FIXED",
				pegToActual: false,
				isRollover: false,
			},
		]);
	});
});

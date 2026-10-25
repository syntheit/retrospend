import { changesAnything, envelopeMoves, hiddenFor } from "./preview";
import type { BudgetPreview } from "./source";

const ars = (minor: number) => ({ minor, currency: "ARS" });

// The server's answer to POST /budget/assign/preview (recorded from a seeded
// book): the pool and one envelope move, Left to spend stays.
const assign = {
	changes: [
		{
			id: "budget.notPlannedYet",
			currency: "ARS",
			before: ars(-206800000),
			after: ars(-207800000),
			delta: ars(-1000000),
			figureAfter: [ars(-207800000)],
		},
		{
			id: "envelope.left",
			currency: "ARS",
			before: ars(-2530000),
			after: ars(-1530000),
			delta: ars(1000000),
			figureAfter: [ars(-1530000)],
		},
	],
	unchanged: [{ id: "budget.leftToSpend", lines: [ars(-164267100)] }],
	unavailable: [],
	detail: {
		kind: "envelope.assign",
		result: {
			movements: [],
			envelopes: [{ id: "e1", before: ars(-2530000), after: ars(-1530000) }],
			toAssign: { before: ars(-206800000), after: ars(-207800000) },
		},
	},
} as unknown as BudgetPreview;

describe("budget preview", () => {
	it("lists the envelopes the write moved, and hides their aggregate figure", () => {
		const moves = envelopeMoves(assign);
		expect(moves).toEqual([
			{ id: "e1", before: ars(-2530000), after: ars(-1530000) },
		]);
		expect(hiddenFor(moves)).toEqual(["envelope.left"]);
		expect(hiddenFor([])).toEqual([]);
	});

	it("survives an answer with no movement detail (Use my plan)", () => {
		const plain = {
			...assign,
			detail: { kind: "envelope.usePlan", result: { batchId: "b", lines: [] } },
		} as unknown as BudgetPreview;
		expect(envelopeMoves(plain)).toEqual([]);
		expect(
			envelopeMoves({ ...plain, detail: undefined } as BudgetPreview),
		).toEqual([]);
	});

	it("says whether the write would do anything", () => {
		expect(changesAnything(assign)).toBe(true);
		const nothing = {
			...assign,
			changes: [],
			detail: { kind: "x", result: { envelopes: [] } },
		} as unknown as BudgetPreview;
		expect(changesAnything(nothing)).toBe(false);
		// A figure that moved counts even when no envelope line is listed.
		const figureOnly = {
			...nothing,
			changes: [assign.changes[0]],
		} as unknown as BudgetPreview;
		expect(changesAnything(figureOnly)).toBe(true);
	});
});

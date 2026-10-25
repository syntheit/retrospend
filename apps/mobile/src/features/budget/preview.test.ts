import { changesAnything, previewRows } from "./preview";
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

describe("budget preview rows", () => {
	it("lists the envelopes the write moved, the pool, and what stays", () => {
		expect(previewRows(assign)).toEqual({
			envelopes: [{ id: "e1", before: ars(-2530000), after: ars(-1530000) }],
			pool: { before: ars(-206800000), after: ars(-207800000) },
			leftToSpend: { stays: [ars(-164267100)] },
		});
	});

	it("reads Left to spend as a change when the write moves it", () => {
		const moved = {
			...assign,
			changes: [
				{
					id: "budget.leftToSpend",
					currency: "ARS",
					before: ars(100),
					after: ars(90),
					delta: ars(-10),
					figureAfter: [ars(90)],
				},
			],
			unchanged: [],
		} as unknown as BudgetPreview;
		expect(previewRows(moved).leftToSpend).toEqual({
			change: { before: ars(100), after: ars(90) },
		});
		expect(previewRows(moved).pool).toBeNull();
	});

	it("survives an answer with no movement detail (Use my plan)", () => {
		const plain = {
			...assign,
			detail: { kind: "envelope.usePlan", result: { batchId: "b", lines: [] } },
		} as unknown as BudgetPreview;
		expect(previewRows(plain).envelopes).toEqual([]);
		expect(previewRows({ ...plain, detail: undefined } as BudgetPreview).envelopes).toEqual([]);
	});

	it("says whether the write would do anything", () => {
		expect(changesAnything(previewRows(assign))).toBe(true);
		const nothing = {
			...assign,
			changes: [],
			detail: { kind: "x", result: { envelopes: [] } },
		} as unknown as BudgetPreview;
		expect(changesAnything(previewRows(nothing))).toBe(false);
	});
});

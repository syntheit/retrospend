import { describe, expect, it } from "vitest";
import {
	checkMergeKinds,
	closedMonthClash,
	MERGE_ROW_POLICY,
	mergeMovesRow,
	moveDraftCategory,
	planBudgets,
	planLinks,
	planPreference,
	restoreDraftCategory,
} from "./plan";
import { CategoryMergeRefusal } from "./refusals";

const row = { direction: "OUT", isAmortizedChild: false, hasLegs: false };

describe("merge rules", () => {
	it("joins two categories of one kind and refuses an expense and an income category", () => {
		expect(() =>
			checkMergeKinds({ kind: "INCOME" }, { kind: "INCOME" }),
		).not.toThrow();
		expect(() => checkMergeKinds({ kind: "EXPENSE" }, null)).not.toThrow();
		for (const [a, b] of [
			["EXPENSE", "INCOME"],
			["INCOME", "EXPENSE"],
		]) {
			expect(() => checkMergeKinds({ kind: a }, { kind: b })).toThrow(
				expect.objectContaining({ problem: "category_kind_mismatch" }),
			);
		}
	});

	it("reaches every row, the ones the entry policy hides included", () => {
		expect(MERGE_ROW_POLICY.outgoingOnly).toBe(false);
		expect(mergeMovesRow({ ...row, direction: "IN" })).toBe(true);
		expect(mergeMovesRow({ ...row, isAmortizedChild: true })).toBe(true);
		expect(mergeMovesRow({ ...row, hasLegs: true })).toBe(true);
	});
});

describe("planBudgets", () => {
	const mine = [
		{ id: "b1", period: 100 },
		{ id: "b2", period: 200 },
		{ id: "b3", period: 300 },
	];
	it("drops the periods the target budgets and moves the rest", () => {
		expect(planBudgets(mine, new Set([200]))).toEqual({
			move: ["b1", "b3"],
			drop: ["b2"],
		});
	});
	it("drops every budget with no target", () => {
		expect(planBudgets(mine, null)).toEqual({
			move: [],
			drop: ["b1", "b2", "b3"],
		});
	});
});

describe("planLinks", () => {
	const src = [
		{ id: "l1", bookId: "A", envelopeId: "food" },
		{ id: "l2", bookId: "B", envelopeId: "fun" },
	];
	it("moves a link the target has none of and reroutes where the target sits in another envelope", () => {
		const tgt = [{ id: "t1", bookId: "A", envelopeId: "treats" }];
		const plan = planLinks(src, tgt, new Map([["B", "other"]]));
		expect(plan.move).toEqual(["l2"]);
		expect(plan.drop).toEqual(["l1"]);
		expect(plan.rerouted).toEqual([
			{ bookId: "A", from: "food", to: "treats" },
		]);
	});
	it("reroutes nothing when both sit in one envelope", () => {
		const tgt = [{ id: "t1", bookId: "A", envelopeId: "food" }];
		expect(
			planLinks([src[0] as (typeof src)[0]], tgt, new Map()).rerouted,
		).toEqual([]);
	});
	it("drops every link on a delete and sends the rows to the default envelope", () => {
		const plan = planLinks(
			src,
			null,
			new Map([
				["A", "rest"],
				["B", "fun"],
			]),
		);
		expect(plan.drop).toEqual(["l1", "l2"]);
		expect(plan.rerouted).toEqual([{ bookId: "A", from: "food", to: "rest" }]);
	});
});

describe("planPreference", () => {
	it("keeps the target's, moves the source's when the target has none", () => {
		expect(planPreference("p", true, true)).toBe("drop");
		expect(planPreference("p", false, true)).toBe("move");
		expect(planPreference("p", false, false)).toBe("drop");
		expect(planPreference(null, false, true)).toBe("none");
	});
});

describe("draft rows", () => {
	const draft = {
		expectedIn: [
			{ categoryId: "a", amountMinor: 1 },
			{ categoryId: "t", amountMinor: 2 },
		],
		pretend: [{ categoryId: "a" }, { categoryId: null }],
	};
	it("moves only the rows that name the source and flips back only those", () => {
		const moved = moveDraftCategory(draft, "a", "t");
		if (!moved) throw new Error("the draft names the category");
		expect(moved.changed).toEqual({ expectedIn: [0], pretend: [0] });
		expect(moved.next.expectedIn).toEqual([
			{ categoryId: "t", amountMinor: 1 },
			{ categoryId: "t", amountMinor: 2 },
		]);
		// The row that named the target before stays on it after the undo.
		const back = restoreDraftCategory(moved.next, moved.changed, "a");
		expect(back).toEqual(draft);
	});
	it("returns null for a draft that does not name it, and uncategorizes on a delete", () => {
		expect(moveDraftCategory(draft, "zzz", "t")).toBeNull();
		expect(moveDraftCategory(draft, "a", null)?.next.pretend).toEqual([
			{ categoryId: null },
			{ categoryId: null },
		]);
	});
});

describe("closedMonthClash", () => {
	const base = {
		sourceId: "src",
		targetId: "tgt",
		defaultEnvelopeId: "rest",
		envelopeIds: new Set(["food", "treats", "rest"]),
		links: new Map([
			["src", "food"],
			["tgt", "treats"],
		]),
	};
	const closedWith = (links: [string, string][] | null) => [
		{ month: 202609, links: links ? new Map(links) : null },
	];
	it("names the month whose frozen links put the two in different envelopes and holds rows of the source", () => {
		expect(
			closedMonthClash({
				...base,
				closed: closedWith([
					["src", "food"],
					["tgt", "treats"],
				]),
				sourceMonths: new Set([202609]),
			}),
		).toBe(202609);
	});
	it("passes when the closed month holds no row of the source", () => {
		expect(
			closedMonthClash({
				...base,
				closed: closedWith([
					["src", "food"],
					["tgt", "treats"],
				]),
				sourceMonths: new Set([202610]),
			}),
		).toBeNull();
	});
	it("passes when both routed to one envelope then, and when neither was linked", () => {
		const rows = new Set([202609]);
		expect(
			closedMonthClash({
				...base,
				closed: closedWith([
					["src", "food"],
					["tgt", "food"],
				]),
				sourceMonths: rows,
			}),
		).toBeNull();
		expect(
			closedMonthClash({ ...base, closed: closedWith([]), sourceMonths: rows }),
		).toBeNull();
	});
	it("routes a delete to the default envelope", () => {
		expect(
			closedMonthClash({
				...base,
				targetId: null,
				closed: closedWith([["src", "food"]]),
				sourceMonths: new Set([202609]),
			}),
		).toBe(202609);
	});
	it("reads a month with no frozen links by today's links, the target taking the source's envelope when it had none", () => {
		const rows = new Set([202609]);
		expect(
			closedMonthClash({
				...base,
				links: new Map([["src", "food"]]),
				closed: closedWith(null),
				sourceMonths: rows,
			}),
		).toBeNull();
		expect(
			closedMonthClash({
				...base,
				closed: closedWith(null),
				sourceMonths: rows,
			}),
		).toBe(202609);
	});
});

describe("CategoryMergeRefusal", () => {
	it("carries the stable code and its message", () => {
		const e = new CategoryMergeRefusal("category_income_rule");
		expect(e.problem).toBe("category_income_rule");
		expect(e.message).toMatch(/income rule/);
	});
});

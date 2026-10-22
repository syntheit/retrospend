import { describe, expect, it } from "vitest";
import {
	type PlanCostTarget,
	planCost,
	runway,
	savingsOutsideEnvelopes,
} from "./plan-cost";
import { type MonthlyTarget, savingsProgress } from "./targets";

/** Whole currency units to minor (2 decimals). */
const m = (n: number) => Math.round(n * 100);

describe("planCost (SPEC §5.13, E6)", () => {
	const monthly = (
		amount: number,
		weeks = 4,
		cadence: MonthlyTarget["cadence"] = "MONTH",
	): PlanCostTarget => ({
		kind: "MONTHLY",
		target: { amount: m(amount), mode: "REFILL", cadence },
		weeksInMonth: weeks,
	});

	it.each<{
		name: string;
		envs: Array<{ id: string; groupId: string | null; target: PlanCostTarget }>;
		groups?: Array<[string, number]>;
		total: number;
	}>([
		{
			name: "monthly, weekly x weeks, a yearly bill per month, a goal's monthly need",
			envs: [
				{ id: "dining", groupId: null, target: monthly(180_000) },
				{ id: "food", groupId: null, target: monthly(150, 5, "WEEK") },
				{
					id: "insurance",
					groupId: null,
					target: {
						kind: "BILL",
						amount: m(1_200),
						repeatMonths: 12,
						needThisMonth: 0,
					},
				},
				{
					id: "trip",
					groupId: null,
					target: { kind: "SAVINGS", monthlyNeed: m(370_000) },
				},
				{ id: "misc", groupId: null, target: { kind: "NONE" } },
			],
			total: 180_000 + 750 + 100 + 370_000,
		},
		{
			name: "a one-off bill counts its need this month",
			envs: [
				{
					id: "visa",
					groupId: null,
					target: {
						kind: "BILL",
						amount: m(900),
						repeatMonths: null,
						needThisMonth: m(300),
					},
				},
			],
			total: 300,
		},
		{
			name: "A3 a group target larger than its children counts instead",
			envs: [{ id: "dining", groupId: "wants", target: monthly(500_000) }],
			groups: [["wants", 720_000]],
			total: 720_000,
		},
		{
			name: "children larger than the group target count as they are",
			envs: [{ id: "dining", groupId: "wants", target: monthly(800_000) }],
			groups: [["wants", 720_000]],
			total: 800_000,
		},
		{
			name: "a group target with no envelopes yet still counts",
			envs: [],
			groups: [["savings", 480_000]],
			total: 480_000,
		},
	])("$name", ({ envs, groups, total }) => {
		const g = new Map((groups ?? []).map(([id, v]) => [id, m(v)]));
		expect(planCost(envs, g).total).toBe(m(total));
	});
});

describe("runway (SPEC §5.13, B15)", () => {
	it.each([
		{
			name: "B15 budget and savings last 7.5 months at the essential plan",
			r: {
				toAssign: 300_000,
				sumLeft: 2_700_000,
				savingsOutside: 4_500_000,
				cost: 1_000_000,
			},
			out: { available: 7_500_000, tenths: 75 },
		},
		{
			name: "rounds down: 7.59 months reads 7.5",
			r: {
				toAssign: 0,
				sumLeft: 7_590_000,
				savingsOutside: 0,
				cost: 1_000_000,
			},
			out: { available: 7_590_000, tenths: 75 },
		},
		{
			name: "nothing left: 0 months",
			r: {
				toAssign: -500_000,
				sumLeft: 200_000,
				savingsOutside: 0,
				cost: 1_000_000,
			},
			out: { available: -300_000, tenths: 0 },
		},
	])("$name", ({ r, out }) => {
		const got = runway({
			toAssign: m(r.toAssign),
			sumLeft: m(r.sumLeft),
			savingsOutside: m(r.savingsOutside),
			essentialPlanCost: m(r.cost),
		});
		expect(got).toEqual({ available: m(out.available), tenths: out.tenths });
	});

	it("never counts a savings goal's Left twice", () => {
		// Vacation holds 1,000,000 in its envelope and moved 500,000 to Wealth; progress is 1,500,000.
		const goal = { left: m(1_000_000), toWealth: m(500_000), fromWealth: 0 };
		const sumLeft = goal.left + m(1_000_000);
		const outside = savingsOutsideEnvelopes([goal]);
		expect(outside).toBe(m(500_000));
		expect(savingsProgress(goal)).toBe(m(1_500_000));
		const got = runway({
			toAssign: 0,
			sumLeft,
			savingsOutside: outside,
			essentialPlanCost: m(1_000_000),
		});
		// 2,500,000 / 1,000,000, not (2,000,000 + 1,500,000) / 1,000,000.
		expect(got).toEqual({ available: m(2_500_000), tenths: 25 });
	});

	it("a goal with a dedicated account adds that account's value, not its transfers", () => {
		expect(
			savingsOutsideEnvelopes([
				{
					toWealth: m(500_000),
					fromWealth: 0,
					dedicatedAccountValue: m(3_000_000),
				},
				{ toWealth: m(200_000), fromWealth: m(50_000) },
			]),
		).toBe(m(3_150_000));
	});

	it("a plan that costs nothing has no runway", () => {
		expect(
			runway({
				toAssign: 1,
				sumLeft: 1,
				savingsOutside: 0,
				essentialPlanCost: 0,
			}),
		).toBeNull();
	});
});

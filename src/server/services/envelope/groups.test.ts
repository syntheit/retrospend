import { describe, expect, it } from "vitest";
import { autoFill } from "./auto-fill";
import {
	type GroupMember,
	groupPlan,
	groupShares,
	groupTargetAmount,
	mainEnvelopeOf,
	percentBase,
	typicalIncome,
} from "./groups";

const m = (n: number) => Math.round(n * 100);

describe("typicalIncome (median of the last 3 closed months)", () => {
	it.each([
		{
			name: "three months: the middle one",
			months: [2_400_000, 2_950_000, 2_500_000],
			out: 2_500_000,
		},
		{
			name: "only the last three count",
			months: [9_000_000, 2_400_000, 2_950_000, 2_500_000],
			out: 2_500_000,
		},
		{
			name: "two months: their mean",
			months: [2_400_000, 2_500_000],
			out: 2_450_000,
		},
		{ name: "one month: itself", months: [2_400_000], out: 2_400_000 },
	])("$name", ({ months, out }) => {
		expect(typicalIncome(months.map(m))).toBe(m(out));
	});

	it("no closed months: no typical income", () => {
		expect(typicalIncome([])).toBeNull();
	});
});

describe("percentBase (SPEC §5.9)", () => {
	it.each([
		{
			name: "this month's budget income once it arrived",
			now: 2_400_000,
			closed: [2_500_000],
			out: { base: m(2_400_000), source: "THIS_MONTH" },
		},
		{
			name: "before payday: typical income",
			now: 0,
			closed: [2_400_000, 2_950_000, 2_500_000],
			out: { base: m(2_500_000), source: "TYPICAL" },
		},
		{ name: "no income at all: no base", now: 0, closed: [], out: null },
	])("$name", ({ now, closed, out }) => {
		expect(
			percentBase({
				thisMonthIncome: m(now),
				closedMonthIncomes: closed.map(m),
			}),
		).toEqual(out);
	});
});

describe("groupTargetAmount", () => {
	it.each([
		{
			name: "A3 Wants 30% of 2,400,000",
			t: { kind: "PERCENT_OF_INCOME" as const, value: 3_000 },
			base: 2_400_000,
			out: 720_000,
		},
		{
			name: "Needs 50% of an odd base rounds half-even",
			t: { kind: "PERCENT_OF_INCOME" as const, value: 5_000 },
			base: 0.03,
			out: 0.02,
		},
		{
			name: "a fixed amount ignores the base",
			t: { kind: "AMOUNT" as const, value: m(600_000) },
			base: 2_400_000,
			out: 600_000,
		},
	])("$name", ({ t, base, out }) => {
		expect(groupTargetAmount(t, m(base))).toBe(m(out));
	});

	it("a % target before any income has no amount yet; no target is null", () => {
		expect(
			groupTargetAmount({ kind: "PERCENT_OF_INCOME", value: 3_000 }, null),
		).toBeNull();
		expect(groupTargetAmount({ kind: "NONE", value: 0 }, m(100))).toBeNull();
	});
});

const member = (
	envelopeId: string,
	order: number,
	hasTarget: boolean,
	assigned: number,
	need: number,
): GroupMember => ({
	envelopeId,
	order,
	hasTarget,
	assigned: m(assigned),
	need: m(need),
});

describe("groupPlan (children first, the rest to the main envelope)", () => {
	it.each([
		{
			name: "A3 Wants 720,000: children's needs, the rest to the main envelope",
			target: 720_000,
			members: [
				member("dining", 1, true, 100_000, 80_000),
				member("fun", 2, true, 0, 50_000),
				member("wants", 3, false, 0, 0),
			],
			main: null,
			out: {
				groupNeed: 620_000,
				childNeeds: 130_000,
				mainEnvelopeId: "wants",
				mainExtra: 490_000,
				childrenOverBy: 0,
			},
		},
		{
			name: "children need more than the group target: guidance, the main gets nothing",
			target: 200_000,
			members: [
				member("dining", 1, true, 0, 180_000),
				member("fun", 2, true, 0, 60_000),
				member("wants", 3, false, 0, 0),
			],
			main: null,
			out: {
				groupNeed: 200_000,
				childNeeds: 240_000,
				mainEnvelopeId: "wants",
				mainExtra: 0,
				childrenOverBy: 40_000,
			},
		},
		{
			name: "a fully assigned group needs nothing more",
			target: 300_000,
			members: [member("wants", 1, false, 300_000, 0)],
			main: null,
			out: {
				groupNeed: 0,
				childNeeds: 0,
				mainEnvelopeId: "wants",
				mainExtra: 0,
				childrenOverBy: 0,
			},
		},
		{
			name: "an explicit main envelope with its own target counts its need once",
			target: 500_000,
			members: [
				member("groceries", 1, true, 0, 300_000),
				member("misc", 2, false, 0, 0),
			],
			main: "groceries",
			out: {
				groupNeed: 500_000,
				childNeeds: 300_000,
				mainEnvelopeId: "groceries",
				mainExtra: 200_000,
				childrenOverBy: 0,
			},
		},
		{
			name: "no envelope without a target and none set: no main envelope",
			target: 500_000,
			members: [member("groceries", 1, true, 0, 300_000)],
			main: null,
			out: {
				groupNeed: 500_000,
				childNeeds: 300_000,
				mainEnvelopeId: null,
				mainExtra: 0,
				childrenOverBy: 0,
			},
		},
	])("$name", ({ target, members, main, out }) => {
		const plan = groupPlan(m(target), members, main);
		expect(plan).toMatchObject({
			...out,
			groupNeed: m(out.groupNeed),
			childNeeds: m(out.childNeeds),
			mainExtra: m(out.mainExtra),
			childrenOverBy: m(out.childrenOverBy),
		});
	});

	it("a main envelope id that is not in the group falls back to the first without a target", () => {
		expect(
			mainEnvelopeOf("elsewhere", [
				member("a", 2, false, 0, 0),
				member("b", 1, false, 0, 0),
			]),
		).toBe("b");
	});

	it("A3 groupPlan feeds auto-fill: the group never takes more than its target", () => {
		const members = [
			member("dining", 1, true, 0, 80_000),
			member("wants", 2, false, 0, 0),
		];
		const plan = groupPlan(m(720_000), members);
		const fill = autoFill(
			m(2_400_000),
			[
				{
					envelopeId: "dining",
					kind: "MONTHLY",
					order: 1,
					left: 0,
					need: m(80_000),
				},
				{ envelopeId: "wants", kind: "NONE", order: 2, left: 0, need: 0 },
			],
			[
				{
					groupOrder: 1,
					envelopeIds: ["dining", "wants"],
					mainEnvelopeId: plan.mainEnvelopeId,
					mainExtra: plan.mainExtra,
				},
			],
		);
		expect(fill.lines.reduce((t, l) => t + l.amount, 0)).toBe(m(720_000));
		expect(fill.left).toBe(m(1_680_000));
	});
});

describe("groupShares (header: planned % and spent %)", () => {
	it.each([
		{
			name: "Wants · planned 30% · spent 31%",
			target: { kind: "PERCENT_OF_INCOME" as const, value: 3_000 },
			amount: 720_000,
			base: 2_400_000,
			spending: 744_000,
			out: { plannedBp: 3_000, spentBp: 3_100 },
		},
		{
			name: "a fixed target shows its share of the base",
			target: { kind: "AMOUNT" as const, value: m(600_000) },
			amount: 600_000,
			base: 2_400_000,
			spending: 0,
			out: { plannedBp: 2_500, spentBp: 0 },
		},
		{
			name: "no base: no percentages",
			target: { kind: "PERCENT_OF_INCOME" as const, value: 3_000 },
			amount: null,
			base: null,
			spending: 1_000,
			out: { plannedBp: null, spentBp: null },
		},
	])("$name", ({ target, amount, base, spending, out }) => {
		expect(
			groupShares({
				target,
				targetAmount: amount == null ? null : m(amount),
				base: base == null ? null : m(base),
				spending: m(spending),
			}),
		).toEqual(out);
	});
});

import { describe, expect, it } from "vitest";
import {
	autoFill,
	type FillCandidate,
	type GroupExtra,
	type MonthlyTarget,
	type PlanCostTarget,
	planCost,
} from "./targets";

/** Whole currency units to minor (2 decimals). */
const m = (n: number) => Math.round(n * 100);

describe("autoFill (SPEC §5.4 order)", () => {
	const c = (
		envelopeId: string,
		kind: FillCandidate["kind"],
		order: number,
		need: number,
		o: Partial<FillCandidate> = {},
	): FillCandidate => ({
		envelopeId,
		kind,
		order,
		left: 0,
		need: m(need),
		...o,
	});

	const s1 = [
		c("groceries", "MONTHLY", 3, 420_000),
		c("vacation", "SAVINGS", 5, 370_000),
		c("internet", "BILL", 2, 38_000, { dueDate: "2026-11-10" }),
		c("dining", "MONTHLY", 4, 180_000),
		c("rent", "BILL", 1, 650_000, { dueDate: "2026-11-05" }),
	];

	it.each<{
		name: string;
		available: number;
		cands: FillCandidate[];
		extras?: GroupExtra[];
		lines: Array<[string, number, string]>;
	}>([
		{
			name: "S1 payday 2,400,000: bills by due date, Monthly, then Savings",
			available: 2_400_000,
			cands: s1,
			lines: [
				["rent", 650_000, "BILL"],
				["internet", 38_000, "BILL"],
				["groceries", 420_000, "MONTHLY"],
				["dining", 180_000, "MONTHLY"],
				["vacation", 370_000, "SAVINGS"],
			],
		},
		{
			name: "runs out mid-list and stops at 0",
			available: 700_000,
			cands: s1,
			lines: [
				["rent", 650_000, "BILL"],
				["internet", 38_000, "BILL"],
				["groceries", 12_000, "MONTHLY"],
			],
		},
		{
			name: "S3 overspent envelopes back to 0 come first",
			available: 50_000,
			cands: [
				c("rent", "BILL", 1, 650_000, { dueDate: "2026-11-05" }),
				c("dining", "MONTHLY", 2, 0, { left: -m(34_000) }),
			],
			lines: [
				["dining", 34_000, "OVERSPENT"],
				["rent", 16_000, "BILL"],
			],
		},
		{
			name: "a cover counts toward that envelope's own need",
			available: 100_000,
			cands: [c("fun", "MONTHLY", 1, 30_000, { left: -m(10_000) })],
			lines: [
				["fun", 10_000, "OVERSPENT"],
				["fun", 20_000, "MONTHLY"],
			],
		},
		{
			name: "group targets go after bills and before Monthly, in group order",
			available: 1_000_000,
			cands: [
				c("dining", "MONTHLY", 1, 100_000),
				c("rent", "BILL", 2, 300_000, { dueDate: "2026-11-05" }),
			],
			extras: [
				{ envelopeId: "wants-main", groupOrder: 2, need: m(50_000) },
				{ envelopeId: "needs-main", groupOrder: 1, need: m(40_000) },
			],
			lines: [
				["rent", 300_000, "BILL"],
				["needs-main", 40_000, "GROUP"],
				["wants-main", 50_000, "GROUP"],
				["dining", 100_000, "MONTHLY"],
			],
		},
		{
			name: "S16 negative To assign fills nothing",
			available: -864_000,
			cands: s1,
			lines: [],
		},
		{
			name: "No target envelopes are never filled",
			available: 100,
			cands: [c("misc", "NONE", 1, 0)],
			lines: [],
		},
	])("$name", ({ available, cands, extras, lines }) => {
		const out = autoFill(m(available), cands, extras);
		expect(out.lines.map((l) => [l.envelopeId, l.amount, l.step])).toEqual(
			lines.map(([id, a, s]) => [id, m(a), s]),
		);
		const filled = out.lines.reduce((t, l) => t + l.amount, 0);
		expect(filled + out.left).toBe(Math.max(0, m(available)));
	});
});

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

import { describe, expect, it } from "vitest";
import { autoFill, type FillCandidate, type TargetedGroup } from "./auto-fill";

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
		groups?: TargetedGroup[];
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
			name: "A3 targeted groups fill after bills, in group order: children, then the main envelope",
			available: 1_000_000,
			cands: [
				c("dining", "MONTHLY", 1, 100_000),
				c("rent", "BILL", 2, 300_000, { dueDate: "2026-11-05" }),
				c("groceries", "MONTHLY", 3, 200_000),
				c("wants-main", "NONE", 4, 0),
				c("needs-main", "NONE", 5, 0),
				c("trip", "SAVINGS", 6, 10_000),
			],
			groups: [
				{
					groupOrder: 2,
					envelopeIds: ["dining", "wants-main"],
					mainEnvelopeId: "wants-main",
					mainExtra: m(50_000),
				},
				{
					groupOrder: 1,
					envelopeIds: ["rent", "groceries", "needs-main"],
					mainEnvelopeId: "needs-main",
					mainExtra: m(40_000),
				},
			],
			lines: [
				["rent", 300_000, "BILL"],
				["groceries", 200_000, "GROUP"],
				["needs-main", 40_000, "GROUP"],
				["dining", 100_000, "GROUP"],
				["wants-main", 50_000, "GROUP"],
				["trip", 10_000, "SAVINGS"],
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
	])("$name", ({ available, cands, groups, lines }) => {
		const out = autoFill(m(available), cands, groups);
		expect(out.lines.map((l) => [l.envelopeId, l.amount, l.step])).toEqual(
			lines.map(([id, a, s]) => [id, m(a), s]),
		);
		const filled = out.lines.reduce((t, l) => t + l.amount, 0);
		expect(filled + out.left).toBe(Math.max(0, m(available)));
	});

	it.each([
		{
			// By hand: group target 500, nothing assigned yet. Groceries (main, set aside 300) is over by 100.
			// Cover 100, then 200 more for its own 300, then the group's other 200: 500 in all.
			name: "a cover counts once when the main envelope has its own target",
			cands: [c("groceries", "MONTHLY", 1, 300, { left: -m(100) })],
			group: {
				envelopeIds: ["groceries"],
				mainEnvelopeId: "groceries",
				mainExtra: 200,
			},
			lines: [
				["groceries", 100, "OVERSPENT"],
				["groceries", 200, "GROUP"],
				["groceries", 200, "GROUP"],
			],
		},
		{
			// By hand: group target 500. Wants (main, no target) is over by 100; Dining needs 300.
			// Cover 100 + Dining 300 + the rest of the group 100 = 500.
			name: "a cover on a main envelope without a target comes off the group's rest",
			cands: [
				c("dining", "MONTHLY", 1, 300),
				c("wants", "NONE", 2, 0, { left: -m(100) }),
			],
			group: {
				envelopeIds: ["dining", "wants"],
				mainEnvelopeId: "wants",
				mainExtra: 200,
			},
			lines: [
				["wants", 100, "OVERSPENT"],
				["dining", 300, "GROUP"],
				["wants", 100, "GROUP"],
			],
		},
	])("$name", ({ cands, group, lines }) => {
		const groups: TargetedGroup[] = [
			{ groupOrder: 1, ...group, mainExtra: m(group.mainExtra) },
		];
		const out = autoFill(m(1_000), cands, groups);
		expect(out.lines.map((l) => [l.envelopeId, l.amount, l.step])).toEqual(
			lines.map(([id, a, s]) => [id, m(a as number), s]),
		);
		expect(out.lines.reduce((t, l) => t + l.amount, 0)).toBe(m(500));
	});
});

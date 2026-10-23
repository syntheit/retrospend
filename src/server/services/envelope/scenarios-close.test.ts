/**
 * P4 scenario rows (wargame 01 §2, 05 A2, build plan 02 §7): month close
 * with leftover-rule snapshots, Limits plan funding, Wealth moves. Through
 * the engine, the close summary and the month view; expected values by hand.
 * Every row checks the SPEC §5.3 invariant.
 */
import { describe, expect, it } from "vitest";
import {
	type ActivityEntry,
	type ClosedRule,
	computeBook,
	type EngineInput,
	invariantSides,
	type MovementEntry,
} from "./engine";
import { closeSummary } from "./month-close";
import { buildMonthView, type ViewBook } from "./month-view";
import type { EnvelopeTarget } from "./needs";
import type { MonthKey } from "./types";

const m = (n: number) => Math.round(n * 100);

interface Env {
	id: string;
	kind?: "MONTHLY" | "SAVINGS";
	rule?: "CARRY" | "RETURN" | "SWEEP";
	sweepTo?: string;
	cats?: string[];
	target?: EnvelopeTarget | null;
	group?: string;
}

function run(p: {
	current: MonthKey;
	today: string;
	envelopes: Env[];
	moneyIn?: Array<[MonthKey, number, "INCOME" | "WEALTH"]>;
	activity?: ActivityEntry[];
	movements?: MovementEntry[];
	closedRules?: Map<MonthKey, Map<string, ClosedRule>>;
	funding?: "INCOME" | "TARGETS";
}) {
	const input: EngineInput = {
		startMonth: 202610,
		currentMonth: p.current,
		defaultEnvelopeId: "everything",
		envelopes: [...p.envelopes, { id: "everything" }].map((e) => ({
			id: e.id,
			kind: e.kind ?? "MONTHLY",
			leftoverRule: e.rule ?? "CARRY",
			sweepToId: e.sweepTo ?? null,
			categoryIds: e.cats ?? [],
		})),
		moneyIn: (p.moneyIn ?? []).map(([month, units, source], i) => ({
			id: `in${i}`,
			month,
			minor: m(units),
			source,
		})),
		activity: p.activity ?? [],
		movements: p.movements ?? [],
		splits: [],
		closedRules: p.closedRules,
	};
	const book: ViewBook = {
		id: "book",
		style: p.funding === "TARGETS" ? "LIMITS" : "FLEX",
		fundingSource: p.funding ?? "INCOME",
		currency: "ARS",
		startMonth: 202610,
		weekStartDay: 1,
		periods: [{ fromMonth: 202610, startDay: 1 }],
		defaultEnvelopeId: "everything",
		groups: [
			{ id: "spending", name: "Spending", role: "SPENDING", order: 0 },
			{ id: "savings", name: "Savings", role: "SAVINGS", order: 1 },
		],
		envelopes: [...p.envelopes, { id: "everything" } as Env].map(
			(e, order) => ({
				id: e.id,
				name: e.id,
				icon: null,
				color: null,
				kind: e.kind ?? "MONTHLY",
				groupId: e.group ?? "spending",
				order,
				categoryIds: e.cats ?? [],
				archived: false,
				target: e.target ?? null,
				targetStartMonth: null,
				foreign: null,
				targetIncomplete: false,
			}),
		),
	};
	const state = computeBook(input);
	const view = (month = p.current) =>
		buildMonthView({
			book,
			input,
			state,
			month,
			today: p.today,
			missingRates: [],
		}).dto;
	const left = (id: string, month = p.current) =>
		view(month)
			.groups.flatMap((g) => g.envelopes)
			.find((e) => e.id === id)?.left.minor;
	return { input, state, view, left, sides: invariantSides(input, state) };
}

const spend = (
	date: string,
	units: number,
	cat: string,
	extra: Partial<ActivityEntry> = {},
): ActivityEntry => ({
	id: `a-${date}-${cat}-${units}`,
	month: Number(date.slice(0, 4) + date.slice(5, 7)),
	date,
	minor: -m(units),
	source: "SPENT",
	categoryId: cat,
	...extra,
});
const mv = (
	id: string,
	month: MonthKey,
	to: string,
	units: number,
): MovementEntry => ({ id, month, from: null, to, minor: m(units) });

function expectInvariant(r: ReturnType<typeof run>) {
	expect(r.sides.budget).toBe(r.sides.ledger);
}

describe("S11 month rollover with the rule each month closed under (Lucía)", () => {
	// October: Dining assigned 180,000, spent 120,000 (Left 60,000);
	// Groceries assigned 420,000, spent 432,000 (Left -12,000).
	const base = {
		current: 202611,
		today: "2026-11-03",
		envelopes: [
			{ id: "dining", cats: ["c-din"] },
			{ id: "groceries", cats: ["c-groc"] },
		],
		moneyIn: [[202610, 2_400_000, "INCOME"]] as Array<
			[MonthKey, number, "INCOME"]
		>,
		movements: [
			mv("a1", 202610, "dining", 180_000),
			mv("a2", 202610, "groceries", 420_000),
		],
		activity: [
			spend("2026-10-12", 120_000, "c-din"),
			spend("2026-10-20", 432_000, "c-groc"),
		],
	};

	it("closed under Carry: Dining starts November with 60,000; Groceries resets and 12,000 comes out of To assign", () => {
		const r = run(base);
		expect(r.left("dining")).toBe(m(60_000));
		expect(r.left("groceries")).toBe(0);
		// 2,400,000 - 600,000 assigned - 12,000 overspend
		expect(r.view().toAssign.amount.minor).toBe(m(1_788_000));
		expectInvariant(r);
	});

	it("Dining switched to Return after October closed under Carry: October's 60,000 still carries (B7)", () => {
		const r = run({
			...base,
			envelopes: [
				{ id: "dining", cats: ["c-din"], rule: "RETURN" },
				{ id: "groceries", cats: ["c-groc"] },
			],
			closedRules: new Map([
				[
					202610,
					new Map([
						["dining", { rule: "CARRY", sweepToId: null }],
						["groceries", { rule: "CARRY", sweepToId: null }],
						["everything", { rule: "CARRY", sweepToId: null }],
					]),
				],
			]),
		});
		expect(r.left("dining")).toBe(m(60_000));
		expect(r.view().toAssign.amount.minor).toBe(m(1_788_000));
		expectInvariant(r);
	});

	it("without a snapshot the new Return rule applies: 60,000 back to To assign (1,848,000)", () => {
		const r = run({
			...base,
			envelopes: [
				{ id: "dining", cats: ["c-din"], rule: "RETURN" },
				{ id: "groceries", cats: ["c-groc"] },
			],
		});
		expect(r.left("dining")).toBe(0);
		expect(r.view().toAssign.amount.minor).toBe(m(1_848_000));
		expectInvariant(r);
	});

	it("the close summary records each envelope, its rule and what it did", () => {
		const r = run(base);
		const s = closeSummary({
			input: r.input,
			state: r.state,
			month: 202610,
			currency: "ARS",
			events: [],
		});
		expect(s).toMatchObject({
			month: 202610,
			moneyIn: m(2_400_000),
			assigned: m(600_000),
			overspent: m(12_000),
			returned: 0,
			held: [],
		});
		expect(s.envelopes.find((e) => e.id === "dining")).toEqual({
			id: "dining",
			carryIn: 0,
			assigned: m(180_000),
			activity: -m(120_000),
			left: m(60_000),
			rule: "CARRY",
			sweepToId: null,
			carried: m(60_000),
			returned: 0,
			swept: 0,
			overspent: 0,
		});
		expect(s.envelopes.find((e) => e.id === "groceries")).toMatchObject({
			left: -m(12_000),
			overspent: m(12_000),
		});
	});

	it("a sweep into an envelope archived since keeps the leftover where it was", () => {
		const r = run({
			...base,
			envelopes: [
				{ id: "dining", cats: ["c-din"], rule: "SWEEP", sweepTo: "gone" },
				{ id: "groceries", cats: ["c-groc"] },
			],
		});
		expect(r.left("dining")).toBe(m(60_000));
		expectInvariant(r);
	});
});

describe("A2 a Limits user who never records income", () => {
	// Dining limit 200,000 (Set aside, leftovers return). Each month opens with
	// a PLAN_FUND of the limit. October: 140,000 spent. November: 230,000.
	const dining: Env = {
		id: "dining",
		cats: ["c-din"],
		rule: "RETURN",
		target: {
			kind: "MONTHLY",
			amount: m(200_000),
			mode: "SET_ASIDE",
			cadence: "MONTH",
		},
	};
	const funds = [
		mv("pf10", 202610, "dining", 200_000),
		mv("pf11", 202611, "dining", 200_000),
		mv("pf12", 202612, "dining", 200_000),
	];

	it("November starts at the limit again, not 260,000 (05 A2)", () => {
		const r = run({
			current: 202611,
			today: "2026-11-02",
			envelopes: [dining],
			movements: funds.slice(0, 2),
			activity: [spend("2026-10-10", 140_000, "c-din")],
			funding: "TARGETS",
		});
		expect(r.left("dining")).toBe(m(200_000));
		expect(r.view().toAssign.amount.minor).toBe(-m(400_000) + m(60_000));
		expectInvariant(r);
	});

	it("an overspent month resets: December opens at 200,000 and the 30,000 comes out of the hidden To assign", () => {
		const r = run({
			current: 202612,
			today: "2026-12-01",
			envelopes: [dining],
			movements: funds,
			activity: [
				spend("2026-10-10", 140_000, "c-din"),
				spend("2026-11-10", 230_000, "c-din"),
			],
			funding: "TARGETS",
		});
		expect(r.left("dining")).toBe(m(200_000));
		// -600,000 funded + 60,000 returned (Oct) - 30,000 overspend (Nov)
		expect(r.view().toAssign.amount.minor).toBe(-m(570_000));
		expectInvariant(r);
	});

	it("with the plan funded, the month's target needs nothing more", () => {
		const r = run({
			current: 202611,
			today: "2026-11-02",
			envelopes: [dining],
			movements: funds.slice(0, 2),
			funding: "TARGETS",
		});
		const row = r.view().groups.flatMap((g) => g.envelopes)[0];
		expect(row?.target?.need.minor).toBe(0);
	});
});

describe("S12 buying USD 300 into Wealth from Savings (Lucía)", () => {
	// USD 300 at blue 1,465 = ARS 439,500 leaves the Savings envelope for a
	// USD account. Savings is a goal of ARS 3,000,000 with 1,000,000 assigned.
	const savings: Env = {
		id: "savings",
		kind: "SAVINGS",
		group: "savings",
		target: {
			kind: "SAVINGS",
			amount: m(3_000_000),
			dueMonth: null,
			monthly: null,
		},
	};
	const base = {
		current: 202610,
		today: "2026-10-15",
		envelopes: [savings],
		moneyIn: [[202610, 2_400_000, "INCOME"]] as Array<
			[MonthKey, number, "INCOME" | "WEALTH"]
		>,
		movements: [mv("s1", 202610, "savings", 1_000_000)],
	};
	const toWealth: ActivityEntry = {
		id: "w1",
		month: 202610,
		date: "2026-10-14",
		minor: -m(439_500),
		source: "WEALTH",
		categoryId: null,
		envelopeId: "savings",
	};

	it("Savings Left drops by 439,500; the goal's progress stays 1,000,000 (B12); To assign is unchanged", () => {
		const before = run(base);
		const after = run({ ...base, activity: [toWealth] });
		expect(after.left("savings")).toBe(m(560_500));
		const goal = (r: ReturnType<typeof run>) =>
			r
				.view()
				.groups.flatMap((g) => g.envelopes)
				.find((e) => e.id === "savings")?.target?.progress?.minor;
		expect(goal(before)).toBe(m(1_000_000));
		expect(goal(after)).toBe(m(1_000_000));
		expect(after.view().toAssign.amount).toEqual(before.view().toAssign.amount);
		expectInvariant(after);
	});

	it("moving it back into To assign later raises To assign by what the sale brought (ARS 450,000)", () => {
		const r = run({
			...base,
			current: 202611,
			today: "2026-11-10",
			activity: [toWealth],
			moneyIn: [...base.moneyIn, [202611, 450_000, "WEALTH"]],
		});
		// 2,400,000 - 1,000,000 assigned + 450,000 from Wealth
		expect(r.view().toAssign.amount.minor).toBe(m(1_850_000));
		expectInvariant(r);
	});
});

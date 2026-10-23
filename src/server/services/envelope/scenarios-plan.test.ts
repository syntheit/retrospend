/**
 * P5 scenarios (02 §8 P5; SPEC §5.9, §5.10, §5.13) through the engine, the
 * month view, the draft preview and Use my plan. Expected values are worked
 * out by hand in the comments before the code ran. Every row checks the
 * SPEC §5.3 invariant, also on a draft's virtual month (a draft moves money
 * between terms; it creates none).
 */
import { describe, expect, it } from "vitest";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { DraftDto } from "~/lib/schemas/envelope-plan";
import { previewDraft, draftInput, fundNowLines } from "./draft-preview";
import {
	computeBook,
	type ActivityEntry,
	type EngineInput,
	type MovementEntry,
} from "./engine";
import { groupTargetDto } from "./group-view";
import type { LoadedBook } from "./inputs";
import { invariantSides } from "./invariant";
import { buildMonthView, type ViewBook } from "./month-view";
import type { EnvelopeTarget } from "./needs";
import type { GroupRole } from "./pace";
import { fillFromTargets } from "./planning";
import type { IncomeRule } from "./rules";
import type { MonthKey } from "./types";

const m = (n: number) => Math.round(n * 100);
const NOV = 202611;
const DEC = 202612;
const TODAY = "2026-11-15";

interface Env {
	id: string;
	group: string;
	cats?: string[];
	kind?: "MONTHLY" | "BILL" | "SAVINGS" | "NONE";
	target?: EnvelopeTarget;
}

interface Book {
	envs: Env[];
	groups: Array<{ id: string; role: GroupRole; pct?: number }>;
	moneyIn?: Array<[MonthKey, number]>;
	moves?: Array<[MonthKey, string | null, string | null, number]>;
	spent?: Array<[string, string, number]>;
}

let seq = 0;
function setup(b: Book) {
	const movements: MovementEntry[] = (b.moves ?? []).map(([month, from, to, units]) => ({
		id: `mv${++seq}`,
		month,
		from,
		to,
		minor: m(units),
	}));
	const activity: ActivityEntry[] = (b.spent ?? []).map(([date, cat, units]) => ({
		id: `a${++seq}`,
		month: NOV,
		date,
		minor: -m(units),
		source: "SPENT",
		categoryId: cat,
	}));
	const input: EngineInput = {
		startMonth: NOV,
		currentMonth: NOV,
		defaultEnvelopeId: b.envs.at(-1)?.id as string,
		envelopes: b.envs.map((e) => ({
			id: e.id,
			kind: e.kind ?? e.target?.kind ?? "MONTHLY",
			leftoverRule: "CARRY",
			sweepToId: null,
			categoryIds: e.cats ?? [],
		})),
		moneyIn: (b.moneyIn ?? []).map(([month, units]) => ({
			id: `in${++seq}`,
			month,
			minor: m(units),
			source: "INCOME" as const,
		})),
		activity,
		movements,
		splits: [],
	};
	const book: ViewBook = {
		id: "book",
		style: "FLEX",
		fundingSource: "INCOME",
		currency: "ARS",
		startMonth: NOV,
		weekStartDay: 1,
		periods: [{ fromMonth: NOV, startDay: 1 }],
		defaultEnvelopeId: input.defaultEnvelopeId,
		groups: b.groups.map((g, order) => ({
			id: g.id,
			name: g.id,
			role: g.role,
			order,
			target: g.pct ? { kind: "PERCENT_OF_INCOME", value: g.pct } : null,
			mainEnvelopeId: null,
		})),
		envelopes: b.envs.map((e, order) => ({
			id: e.id,
			name: e.id,
			icon: null,
			color: null,
			kind: e.kind ?? e.target?.kind ?? "MONTHLY",
			groupId: e.group,
			order,
			categoryIds: e.cats ?? [],
			archived: false,
			target: e.target ?? null,
			targetStartMonth: null,
			foreign: null,
			targetIncomplete: false,
		})),
	};
	const loaded = { book, input, today: TODAY, missingRates: [] } as unknown as LoadedBook;
	const view = (month: MonthKey, base?: { base: number; source: "THIS_MONTH" | "TYPICAL" }): GetMonthOutput =>
		buildMonthView({
			book,
			input,
			state: computeBook(input, month),
			month,
			today: TODAY,
			missingRates: [],
			groupBase: base ? { ...base, incomplete: false } : null,
		}).dto;
	return { input, book, loaded, view };
}

const draft = (o: Partial<DraftDto>): DraftDto => ({
	id: "d1",
	kind: "WHAT_IF",
	month: NOV,
	status: "OPEN",
	lines: [],
	moves: [],
	expectedIn: [],
	pretend: [],
	appliedAt: null,
	fundedBatchId: null,
	updatedAt: new Date(0),
	...o,
});

const ars = (units: number) => ({ minor: m(units), currency: "ARS" });

describe("D10 what if I buy a 1,200,000 laptop this month (05 D10, SPEC §5.13)", () => {
	// Nov: money in 1,500,000; Tech 300,000, Dining 200,000, Savings 900,000
	// assigned, so To assign 100,000. Dining spent 50,000 (Left 150,000).
	// The laptop is a pretend Tech expense of 1,200,000: Tech Left
	// 300,000 - 1,200,000 = -900,000, To assign stays 100,000. Cover: To
	// assign 100,000, then Monthly by Left (Dining 150,000), then Savings
	// 650,000; nothing uncovered.
	const b = setup({
		groups: [{ id: "spend", role: "SPENDING" }, { id: "save", role: "SAVINGS" }],
		envs: [
			{ id: "tech", group: "spend", cats: ["c-tech"] },
			{ id: "dining", group: "spend", cats: ["c-dining"] },
			{ id: "savings", group: "save", kind: "SAVINGS" },
			{ id: "else", group: "spend" },
		],
		moneyIn: [[NOV, 1_500_000]],
		moves: [
			[NOV, null, "tech", 300_000],
			[NOV, null, "dining", 200_000],
			[NOV, null, "savings", 900_000],
		],
		spent: [["2026-11-05", "c-dining", 50_000]],
	});
	const d = draft({
		pretend: [
			{ id: "00000000-0000-4000-8000-000000000001", kind: "OUT", categoryId: "c-tech", envelopeId: null, amountMinor: m(1_200_000) },
		],
	});
	const base = b.view(NOV);
	const p = previewDraft({ loaded: b.loaded, base, current: base, draft: d, rules: [], nowMs: 0 });

	it("shows Tech going short by 900,000 and To assign unchanged", () => {
		expect(p.toAssign).toEqual({ before: ars(100_000), after: ars(100_000) });
		expect(p.envelopes).toEqual([
			expect.objectContaining({
				envelopeId: "tech",
				activity: { before: ars(0), after: ars(-1_200_000) },
				left: { before: ars(300_000), after: ars(-900_000) },
				short: true,
			}),
		]);
	});

	it("suggests a cover: To assign 100,000, Dining 150,000, Savings 650,000", () => {
		expect(p.shortfalls).toEqual([
			{
				envelopeId: "tech",
				short: ars(900_000),
				cover: [
					{ from: null, amount: ars(100_000) },
					{ from: "dining", amount: ars(150_000) },
					{ from: "savings", amount: ars(650_000) },
				],
				uncovered: ars(0),
			},
		]);
		expect(p.fundNow).toBeNull();
	});

	it("the invariant holds on the real month and on the pretend one", () => {
		const real = invariantSides(b.input, computeBook(b.input));
		expect(real.budget).toBe(real.ledger);
		const run = draftInput(b.loaded, base, d, [], 0);
		const virtual = invariantSides(run.input, computeBook(run.input));
		expect(virtual.budget).toBe(virtual.ledger);
	});
});

describe("A4 plan next month with expected money in and a Save first rule (SPEC §5.10, §5.13)", () => {
	// Nov: money in 1,300,000, Rent 500,000 and Spending 500,000 assigned:
	// To assign 300,000, which is also December's To assign before the plan.
	// December plan: expected salary 2,400,000; the rule "20% to Savings"
	// previews 480,000; plan lines Rent 500,000 and Spending 1,400,000.
	// After: 300,000 + 2,400,000 - 480,000 - 500,000 - 1,400,000 = 320,000.
	// Fund it now takes this month's 300,000 in plan order: Rent 300,000.
	const b = setup({
		groups: [{ id: "bills", role: "BILLS" }, { id: "spend", role: "SPENDING" }, { id: "save", role: "SAVINGS" }],
		envs: [
			{ id: "rent", group: "bills", cats: ["c-rent"] },
			{ id: "savings", group: "save", kind: "SAVINGS" },
			{ id: "spending", group: "spend" },
		],
		moneyIn: [[NOV, 1_300_000]],
		moves: [
			[NOV, null, "rent", 500_000],
			[NOV, null, "spending", 500_000],
		],
	});
	const rules: IncomeRule[] = [
		{
			id: "save",
			sortOrder: 0,
			envelopeId: "savings",
			active: true,
			createdAtMs: 0,
			match: { kind: "ANY" },
			action: { kind: "PERCENT", basisPoints: 2_000 },
		},
	];
	const d = draft({
		kind: "PLAN",
		month: DEC,
		lines: [
			{ envelopeId: "rent", amountMinor: m(500_000) },
			{ envelopeId: "spending", amountMinor: m(1_400_000) },
		],
		expectedIn: [
			{ id: "00000000-0000-4000-8000-000000000002", templateId: "salary", categoryId: null, amountMinor: m(2_400_000) },
		],
	});
	const current = b.view(NOV);
	const dec = b.view(DEC);
	const p = previewDraft({ loaded: b.loaded, base: dec, current, draft: d, rules, nowMs: 1 });

	it("previews the rule on the expected money in and next month's To assign", () => {
		expect(dec.toAssign.amount).toEqual(ars(300_000));
		expect(p.ruleLines).toEqual([
			{ sourceId: "00000000-0000-4000-8000-000000000002", ruleId: "save", envelopeId: "savings", amount: ars(480_000) },
		]);
		expect(p.toAssign.after).toEqual(ars(320_000));
		expect(p.envelopes.map((e) => [e.envelopeId, e.assigned.after.minor])).toEqual([
			["rent", m(500_000)],
			["spending", m(1_400_000)],
			["savings", m(480_000)],
		]);
	});

	it("Fund it now takes 300,000 from this month, Rent first", () => {
		expect(p.fundNow).toEqual(ars(300_000));
		expect(fundNowLines(d.lines, dec, current.toAssign.amount.minor)).toEqual([
			{ envelopeId: "rent", amount: m(300_000) },
		]);
	});

	it("the preview writes nothing: the real December is as before", () => {
		expect(b.view(DEC)).toEqual(dec);
	});

	it("Use my plan in December starts from the saved plan, then the targets", () => {
		// 1,000,000 arrives: Rent 500,000 and Spending 500,000 in plan order.
		const plan = d.lines;
		const one = fillFromTargets(dec, m(1_000_000), plan);
		expect(one.lines.map((l) => [l.envelopeId, l.amount.minor, l.step])).toEqual([
			["rent", m(500_000), "PLAN"],
			["spending", m(500_000), "PLAN"],
		]);
		expect(one.rest).toEqual(ars(0));
		// 2,000,000 arrives: the whole plan (1,900,000) and 100,000 stays Not planned yet.
		const two = fillFromTargets(dec, m(2_000_000), plan);
		expect(two.lines.reduce((s, l) => s + l.amount.minor, 0)).toBe(m(1_900_000));
		expect(two.rest).toEqual(ars(100_000));
	});
});

describe("A3 50/30/20 group targets (SPEC §5.9, 05 A3)", () => {
	// Money in this month 2,000,000. Needs 50% = 1,000,000 with Rent
	// (Set aside 700,000) and the Needs envelope; Wants 30% = 600,000, spent
	// 310,000 (spent 15.5%); Savings 20% = 400,000. Nothing assigned.
	const b = setup({
		groups: [
			{ id: "needs", role: "BILLS", pct: 5_000 },
			{ id: "wants", role: "SPENDING", pct: 3_000 },
			{ id: "save", role: "SAVINGS", pct: 2_000 },
		],
		envs: [
			{
				id: "rent",
				group: "needs",
				cats: ["c-rent"],
				target: { kind: "MONTHLY", amount: m(700_000), mode: "SET_ASIDE", cadence: "MONTH" },
			},
			{ id: "needs", group: "needs" },
			{ id: "savings", group: "save", kind: "SAVINGS" },
			{ id: "wants", group: "wants", cats: ["c-fun"] },
		],
		moneyIn: [[NOV, 2_000_000]],
		spent: [["2026-11-03", "c-fun", 310_000]],
	});
	const v = b.view(NOV, { base: m(2_000_000), source: "THIS_MONTH" });
	const target = (id: string) => v.groups.find((g) => g.id === id)?.target;

	it("headers: planned and spent shares of this month's money in", () => {
		expect(target("needs")).toMatchObject({
			amount: ars(1_000_000),
			plannedBp: 5_000,
			spentBp: 0,
			need: ars(1_000_000),
			mainEnvelopeId: "needs",
			mainExtra: ars(300_000),
			childrenOverBy: ars(0),
			baseSource: "THIS_MONTH",
		});
		expect(target("wants")).toMatchObject({ amount: ars(600_000), plannedBp: 3_000, spentBp: 1_550 });
		expect(target("save")).toMatchObject({ amount: ars(400_000), mainExtra: ars(400_000) });
	});

	it("Use my plan fills the overspend, then the groups in order", () => {
		const fill = fillFromTargets(v);
		expect(fill.lines.map((l) => [l.envelopeId, l.amount.minor, l.step])).toEqual([
			["wants", m(310_000), "OVERSPENT"],
			["rent", m(700_000), "GROUP"],
			["needs", m(300_000), "GROUP"],
			["wants", m(290_000), "GROUP"],
			["savings", m(400_000), "GROUP"],
		]);
		expect(fill.rest).toEqual(ars(0));
	});

	it("before payday the base is typical income, labeled as such", () => {
		const dto = groupTargetDto(
			{ target: { kind: "PERCENT_OF_INCOME", value: 3_000 }, mainEnvelopeId: null },
			[],
			{ base: m(1_800_000), source: "TYPICAL", incomplete: false },
			(minor) => ({ minor, currency: "ARS" }),
		);
		expect(dto).toMatchObject({ amount: ars(540_000), baseSource: "TYPICAL", need: ars(540_000) });
		expect(
			groupTargetDto({ target: { kind: "PERCENT_OF_INCOME", value: 3_000 } }, [], null, (minor) => ({ minor, currency: "ARS" })),
		).toMatchObject({ amount: null, need: ars(0), plannedBp: null });
	});

	it("the invariant holds", () => {
		const s = invariantSides(b.input, computeBook(b.input));
		expect(s.budget).toBe(s.ledger);
	});
});

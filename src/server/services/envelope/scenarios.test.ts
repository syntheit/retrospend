/**
 * Budget scenarios (wargame 01 §2, build plan 02 §7) that P2 covers, run
 * through the engine, the month view and the plan proposals. Expected values
 * are worked out by hand in the comments, never read back from the engine.
 * Every row also checks the SPEC §5.3 invariant:
 *   ToAssign(c) + Σ Left(e, c) + Assigned(c+1) = MoneyIn - Σ outflows - SplitsNet
 */
import { describe, expect, it } from "vitest";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import {
	type ActivityEntry,
	computeBook,
	type EngineInput,
	invariantSides,
	type MoneyInEntry,
	type MovementEntry,
} from "./engine";
import { buildMonthView, type ViewBook, type ViewEnvelope } from "./month-view";
import type { EnvelopeTarget } from "./needs";
import type { GroupRole } from "./pace";
import { coverSources, fillFromTargets, moveCap } from "./planning";
import { replaySplits } from "./splits-replay";
import { bookContext } from "./test-fixtures";
import type { IsoDate, MonthKey } from "./types";
import { convertToBook, valueRow } from "./valuation";
import type { BudgetStyle } from "./verdict";

/** Whole currency units to minor units (every book here has 2 decimals). */
const m = (n: number) => Math.round(n * 100);

interface EnvSpec {
	id: string;
	group?: string;
	kind?: ViewEnvelope["kind"];
	cats?: string[];
	target?: EnvelopeTarget;
	rule?: "CARRY" | "RETURN" | "SWEEP";
	sweepTo?: string;
	foreign?: { minor: number; currency: string };
}

interface Scenario {
	currency: string;
	style?: BudgetStyle;
	start: MonthKey;
	current: MonthKey;
	today: IsoDate;
	groups?: Array<[string, GroupRole]>;
	envelopes: EnvSpec[];
	defaultEnvelope: string;
	moneyIn?: MoneyInEntry[];
	activity?: ActivityEntry[];
	movements?: MovementEntry[];
	splits?: EngineInput["splits"];
	weekStartDay?: number;
}

const FLEX_GROUPS: Array<[string, GroupRole]> = [
	["bills", "BILLS"],
	["spending", "SPENDING"],
	["savings", "SAVINGS"],
];

let seq = 0;
const income = (
	month: MonthKey,
	units: number,
	source: MoneyInEntry["source"] = "INCOME",
): MoneyInEntry => ({
	id: `in${++seq}`,
	month,
	minor: m(units),
	source,
});
const spend = (
	date: IsoDate,
	units: number,
	categoryId: string | null,
	extra: Partial<ActivityEntry> = {},
): ActivityEntry => ({
	id: `a${++seq}`,
	month: Number(date.slice(0, 4) + date.slice(5, 7)),
	date,
	minor: -m(units),
	source: "SPENT",
	categoryId,
	...extra,
});
const move = (
	month: MonthKey,
	from: string | null,
	to: string | null,
	units: number,
): MovementEntry => ({
	id: `mv${++seq}`,
	month,
	from,
	to,
	minor: m(units),
});
/** The mirror rows an undo appends (D28). */
const undo = (rows: MovementEntry[]) =>
	rows.map((r) => ({ ...r, id: `${r.id}-undo`, from: r.to, to: r.from }));

function run(s: Scenario) {
	const input: EngineInput = {
		startMonth: s.start,
		currentMonth: s.current,
		defaultEnvelopeId: s.defaultEnvelope,
		envelopes: s.envelopes.map((e) => ({
			id: e.id,
			kind: e.kind ?? e.target?.kind ?? "MONTHLY",
			leftoverRule: e.rule ?? "CARRY",
			sweepToId: e.sweepTo ?? null,
			categoryIds: e.cats ?? [],
		})),
		moneyIn: s.moneyIn ?? [],
		activity: s.activity ?? [],
		movements: s.movements ?? [],
		splits: s.splits ?? [],
	};
	const groups = s.groups ?? FLEX_GROUPS;
	const book: ViewBook = {
		id: "book",
		style: s.style ?? "FLEX",
		fundingSource: "INCOME",
		currency: s.currency,
		startMonth: s.start,
		weekStartDay: s.weekStartDay ?? 1,
		periods: [{ fromMonth: s.start, startDay: 1 }],
		defaultEnvelopeId: s.defaultEnvelope,
		groups: groups.map(([id, role], order) => ({ id, name: id, role, order })),
		envelopes: s.envelopes.map((e, order) => ({
			id: e.id,
			name: e.id,
			icon: null,
			color: null,
			kind: e.kind ?? e.target?.kind ?? "MONTHLY",
			groupId: e.group ?? null,
			order,
			categoryIds: e.cats ?? [],
			archived: false,
			target: e.target ?? null,
			targetStartMonth: null,
			foreign: e.foreign ?? null,
			targetIncomplete: false,
		})),
	};
	const state = computeBook(input);
	const view = (month = s.current): GetMonthOutput =>
		buildMonthView({
			book,
			input,
			state,
			month,
			today: s.today,
			missingRates: [],
		}).dto;
	const sides = invariantSides(input, state);
	return { input, state, view, sides };
}

/** The SPEC §5.3 invariant, on every row. */
function expectInvariant(r: ReturnType<typeof run>) {
	expect(r.sides.budget).toBe(r.sides.ledger);
}

const row = (v: GetMonthOutput, id: string) => {
	const found = v.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);
	if (!found) throw new Error(`no row ${id}`);
	return found;
};
const left = (v: GetMonthOutput, id: string) => row(v, id).left.minor;

// ── Lucía, Buenos Aires (P1) ────────────────────────────────────────────────

const LUCIA: EnvSpec[] = [
	{
		id: "rent",
		group: "bills",
		cats: ["c-rent"],
		target: {
			kind: "BILL",
			amount: m(650_000),
			dueDate: "2026-11-10",
			repeatMonths: 1,
			linkedToTemplate: false,
		},
	},
	{
		id: "groceries",
		group: "spending",
		cats: ["c-groc"],
		target: {
			kind: "MONTHLY",
			amount: m(420_000),
			mode: "REFILL",
			cadence: "MONTH",
		},
	},
	{
		id: "dining",
		group: "spending",
		cats: ["c-din"],
		target: {
			kind: "MONTHLY",
			amount: m(180_000),
			mode: "REFILL",
			cadence: "MONTH",
		},
	},
	{ id: "spending", group: "spending" },
	{ id: "vacation", group: "savings", kind: "SAVINGS" },
];

describe("S1 payday assign and undo (Lucía, ARS)", () => {
	const base: Scenario = {
		currency: "ARS",
		start: 202611,
		current: 202611,
		today: "2026-11-05",
		envelopes: LUCIA,
		defaultEnvelope: "spending",
		moneyIn: [income(202611, 2_400_000)],
	};
	const plan = [
		move(202611, null, "rent", 650_000),
		move(202611, null, "groceries", 420_000),
		move(202611, null, "dining", 180_000),
	];

	it("before assigning: the salary is Not planned yet; the plan proposes rent, then groceries and dining", () => {
		const r = run(base);
		const v = r.view();
		expect(v.toAssign.amount.minor).toBe(m(2_400_000));
		expect(v.toAssign.poolName).toBe("NOT_PLANNED_YET");
		const fill = fillFromTargets(v);
		// Bills first (rent 650,000), then Monthly in order: 420,000 + 180,000.
		expect(
			fill.lines.map((l) => [l.envelopeId, l.amount.minor, l.step]),
		).toEqual([
			["rent", m(650_000), "BILL"],
			["groceries", m(420_000), "MONTHLY"],
			["dining", m(180_000), "MONTHLY"],
		]);
		// 2,400,000 - 1,250,000 stays Not planned yet (D-owner-2026-10-22e).
		expect(fill.rest.minor).toBe(m(1_150_000));
		expect(v.verdict.state).toBe("BILLS_SHORT");
		expect(v.verdict.billsShort.minor).toBe(m(650_000));
		expectInvariant(r);
	});

	it("after assigning: 1,150,000 left to plan, 600,000 to spend, about 23,076.92 a day for 26 days", () => {
		const r = run({ ...base, movements: plan });
		const v = r.view();
		expect(v.toAssign.amount.minor).toBe(m(1_150_000));
		expect(left(v, "rent")).toBe(m(650_000));
		// Spending group: 420,000 + 180,000 + 0.
		expect(v.leftToSpend.left.minor).toBe(m(600_000));
		// Nov 5 to Nov 30 is 26 days; 60,000,000 / 26 = 2,307,692.3 minor.
		expect(v.verdict.daysLeft).toBe(26);
		expect(v.verdict.perDay.minor).toBe(2_307_692);
		expect(v.verdict.state).toBe("ON_TRACK");
		expect(v.verdict.notice).toEqual({
			kind: "NOT_PLANNED_YET",
			amount: { minor: m(1_150_000), currency: "ARS" },
			action: "USE_PLAN",
		});
		expect(row(v, "groceries").status).toBe("FUNDED");
		expectInvariant(r);
	});

	it("undo appends mirror rows and puts every number back", () => {
		const r = run({ ...base, movements: [...plan, ...undo(plan)] });
		const v = r.view();
		expect(v.toAssign.amount.minor).toBe(m(2_400_000));
		for (const id of ["rent", "groceries", "dining"])
			expect(left(v, id)).toBe(0);
		expectInvariant(r);
	});
});

describe("S3 overspend recovery (Lucía)", () => {
	const s: Scenario = {
		currency: "ARS",
		start: 202611,
		current: 202611,
		today: "2026-11-22",
		envelopes: [...LUCIA, { id: "fun", group: "spending", cats: ["c-fun"] }],
		defaultEnvelope: "spending",
		moneyIn: [income(202611, 2_400_000)],
		activity: [
			spend("2026-11-10", 650_000, "c-rent"),
			spend("2026-11-12", 324_000, "c-groc"),
			spend("2026-11-20", 214_000, "c-din"),
		],
		movements: [
			move(202611, null, "rent", 650_000),
			move(202611, null, "groceries", 420_000),
			move(202611, null, "dining", 180_000),
			move(202611, null, "fun", 40_000),
			move(202611, null, "vacation", 1_110_000),
		],
	};

	it("Dining at -34,000 is overspent; cover sources run Monthly by Left, then Savings, then Bills", () => {
		const r = run(s);
		const v = r.view();
		expect(v.toAssign.amount.minor).toBe(0);
		expect(left(v, "dining")).toBe(-m(34_000));
		expect(row(v, "dining").status).toBe("OVERSPENT");
		expect(left(v, "groceries")).toBe(m(96_000));
		// To assign is 0, so it is not offered. Groceries 96,000, Fun 40,000,
		// then Vacation 1,110,000 (savings). Spending and Rent hold 0.
		expect(
			coverSources(v, "dining").map((c) => [
				c.from,
				c.available.minor,
				c.dueDate,
			]),
		).toEqual([
			["groceries", m(96_000), null],
			["fun", m(40_000), null],
			["vacation", m(1_110_000), null],
		]);
		// Spending group: 96,000 - 34,000 + 40,000 + 0 = 102,000. Spent 538,000
		// of 640,000 (84%) on day 22 of 30 (73%): faster than planned.
		expect(v.leftToSpend.left.minor).toBe(m(102_000));
		expect(v.verdict.state).toBe("FASTER_THAN_PLANNED");
		expect(v.verdict.overEnvelopes).toEqual([
			{ id: "dining", over: { minor: m(34_000), currency: "ARS" } },
		]);
		expectInvariant(r);
	});

	it("cover 34,000 from Groceries: Dining back to 0, To assign unchanged", () => {
		const r = run({
			...s,
			movements: [
				...(s.movements ?? []),
				move(202611, "groceries", "dining", 34_000),
			],
		});
		const v = r.view();
		expect(left(v, "dining")).toBe(0);
		expect(left(v, "groceries")).toBe(m(62_000));
		expect(v.toAssign.amount.minor).toBe(0);
		expect(v.verdict.overEnvelopes).toEqual([]);
		expectInvariant(r);
	});
});

describe("S9 annual sinking fund (Jordan, USD)", () => {
	const insurance: EnvSpec = {
		id: "insurance",
		group: "bills",
		cats: ["c-ins"],
		target: {
			kind: "BILL",
			amount: m(1_200),
			dueDate: "2027-05-15",
			repeatMonths: 12,
			linkedToTemplate: false,
		},
	};
	const base: Scenario = {
		currency: "USD",
		start: 202611,
		current: 202611,
		today: "2026-11-03",
		envelopes: [insurance, { id: "spending", group: "spending" }],
		defaultEnvelope: "spending",
		moneyIn: [income(202611, 1_000)],
	};

	it("from November: 7 months left, USD 171.43 a month (SPEC §5.4)", () => {
		const r = run(base);
		const t = row(r.view(), "insurance").target;
		// ceil(120,000 / 7) = 17,143 minor.
		expect(t).toMatchObject({
			monthsLeft: 7,
			need: { minor: 17_143 },
			perMonth: { minor: 17_143 },
			dueDate: "2027-05-15",
		});
		expectInvariant(r);
	});

	it("December, with November's 171.43 carried: 6 months left, still 171.43", () => {
		const r = run({
			...base,
			movements: [move(202611, null, "insurance", 171.43)],
		});
		const t = row(r.view(202612), "insurance").target;
		// ceil((120,000 - 17,143) / 6) = ceil(17,142.83) = 17,143.
		expect(t).toMatchObject({ monthsLeft: 6, need: { minor: 17_143 } });
		expect(r.view().toAssign.amount.minor).toBe(m(1_000) - 17_143);
		expectInvariant(r);
	});

	it("paid in May: the cycle closes and the next due is a year later", () => {
		const r = run({
			...base,
			start: 202705,
			current: 202705,
			today: "2027-05-16",
			moneyIn: [income(202705, 1_200)],
			movements: [move(202705, null, "insurance", 1_200)],
			activity: [spend("2027-05-15", 1_200, "c-ins")],
		});
		const t = row(r.view(), "insurance").target;
		expect(t).toMatchObject({
			paid: true,
			dueDate: "2028-05-15",
			need: { minor: 0 },
		});
		expect(left(r.view(), "insurance")).toBe(0);
		expectInvariant(r);
	});
});

describe("S10 a USD target in an ARS book (D25)", () => {
	const ctx = bookContext("ARS", { defaultRateType: "blue" });
	const aH = (date: IsoDate, month: MonthKey) => {
		const v = convertToBook("2000", "USD", { date, month }, ctx);
		if (!v.ok) throw new Error("rate");
		return v.minor;
	};
	const goal = (amount: number): EnvSpec => ({
		id: "vacation",
		group: "savings",
		target: { kind: "SAVINGS", amount, dueMonth: 202701, monthly: null },
		foreign: { minor: 200_000, currency: "USD" },
	});

	it("October at blue 1,465: ARS 2,930,000 over 4 months is 732,500 a month", () => {
		const amount = aH("2026-10-10", 202610);
		expect(amount).toBe(m(2_930_000));
		const r = run({
			currency: "ARS",
			start: 202610,
			current: 202610,
			today: "2026-10-10",
			envelopes: [goal(amount), { id: "spending", group: "spending" }],
			defaultEnvelope: "spending",
		});
		expect(row(r.view(), "vacation").target).toMatchObject({
			need: { minor: m(732_500) },
			monthsLeft: 4,
			foreign: { minor: 200_000, currency: "USD" },
		});
		expectInvariant(r);
	});

	it("January at blue 1,530 with 2,200,000 saved: the goal grew to 3,060,000, 860,000 still needed", () => {
		const amount = aH("2027-01-02", 202701);
		expect(amount).toBe(m(3_060_000));
		const r = run({
			currency: "ARS",
			start: 202612,
			current: 202701,
			today: "2027-01-02",
			envelopes: [goal(amount), { id: "spending", group: "spending" }],
			defaultEnvelope: "spending",
			moneyIn: [income(202612, 2_200_000)],
			movements: [move(202612, null, "vacation", 2_200_000)],
		});
		expect(row(r.view(), "vacation").target).toMatchObject({
			need: { minor: m(860_000) },
			progress: { minor: m(2_200_000) },
		});
		expectInvariant(r);
	});
});

describe("S11 month rollover, derived (Lucía, October to November)", () => {
	const r = run({
		currency: "ARS",
		start: 202610,
		current: 202611,
		today: "2026-11-02",
		envelopes: LUCIA,
		defaultEnvelope: "spending",
		moneyIn: [income(202610, 2_400_000)],
		activity: [
			spend("2026-10-10", 650_000, "c-rent"),
			spend("2026-10-20", 375_000, "c-groc"),
			spend("2026-10-25", 192_000, "c-din"),
		],
		movements: [
			move(202610, null, "rent", 650_000),
			move(202610, null, "groceries", 420_000),
			move(202610, null, "dining", 180_000),
			move(202610, null, "vacation", 1_150_000),
		],
	});

	it("leftovers carry, Dining's -12,000 resets and comes out of November's To assign", () => {
		const nov = r.view();
		expect(row(nov, "groceries").carryIn.minor).toBe(m(45_000));
		expect(row(nov, "dining").carryIn.minor).toBe(0);
		expect(row(nov, "vacation").carryIn.minor).toBe(m(1_150_000));
		// 2,400,000 - 2,400,000 assigned - 12,000 overspend taken.
		expect(nov.toAssign.amount.minor).toBe(-m(12_000));
		expect(nov.toAssign.terms.overspendTaken.minor).toBe(m(12_000));
		expect(nov.verdict.state).toBe("PLANNED_TOO_MUCH");
		expectInvariant(r);
	});

	it("the closed October still reads as it was", () => {
		const oct = r.view(202610);
		expect(oct.month.state).toBe("CLOSED");
		expect(oct.toAssign.amount.minor).toBe(0);
		expect(left(oct, "dining")).toBe(-m(12_000));
		expect(row(oct, "dining").target).toBeNull();
	});
});

describe("S15 unassigning is capped at what the envelope holds (Jonas, EUR)", () => {
	const s: Scenario = {
		currency: "EUR",
		start: 202610,
		current: 202610,
		today: "2026-10-20",
		envelopes: [
			{ id: "fun", group: "spending", cats: ["c-fun"] },
			{ id: "spending", group: "spending" },
		],
		defaultEnvelope: "spending",
		moneyIn: [income(202610, 300)],
		activity: [spend("2026-10-12", 220, "c-fun")],
		movements: [move(202610, null, "fun", 300)],
	};

	it("Fun holds 80 after spending 220 of 300: at most 80 comes back", () => {
		const r = run(s);
		expect(moveCap(row(r.view(), "fun"))).toBe(m(80));
		expectInvariant(r);
	});

	it("taking the 80 back leaves Fun at 0 and To assign at 80", () => {
		const r = run({
			...s,
			movements: [...(s.movements ?? []), move(202610, "fun", null, 80)],
		});
		expect(left(r.view(), "fun")).toBe(0);
		expect(r.view().toAssign.amount.minor).toBe(m(80));
		expectInvariant(r);
	});
});

describe("S16 a deleted income leaves To assign negative (Rafael, BRL)", () => {
	const ctx = bookContext("BRL");
	const invoice = valueRow(
		{
			id: "inv",
			amount: "1600",
			currency: "USD",
			date: "2026-10-19",
			month: 202610,
		},
		ctx,
	);
	if (!invoice.ok) throw new Error("rate");
	const s = (style: BudgetStyle, withIncome: boolean): Scenario => ({
		currency: "BRL",
		style,
		start: 202610,
		current: 202610,
		today: "2026-10-25",
		envelopes: [
			{ id: "rent", group: "bills" },
			{ id: "spending", group: "spending" },
		],
		defaultEnvelope: "spending",
		moneyIn: withIncome
			? [{ id: "inv", month: 202610, minor: invoice.minor, source: "INCOME" }]
			: [],
		movements: [
			move(202610, null, "spending", 5_000),
			move(202610, null, "rent", 3_640),
		],
	});

	it("USD 1,600 at 5.40 entered as BRL 8,640 and was fully assigned", () => {
		expect(invoice.minor).toBe(m(8_640));
		const r = run(s("FLEX", true));
		expect(r.view().toAssign.amount.minor).toBe(0);
		expectInvariant(r);
	});

	it("Flex: planned 8,640 more than you have, taken off Left to spend", () => {
		const r = run(s("FLEX", false));
		const v = r.view();
		expect(v.toAssign.amount.minor).toBe(-m(8_640));
		expect(v.verdict).toMatchObject({
			state: "PLANNED_TOO_MUCH",
			action: "FIX_PLAN",
			plannedTooMuch: { minor: m(8_640) },
		});
		// Spending 5,000 minus the 8,640 planned too much.
		expect(v.leftToSpend.left.minor).toBe(-m(3_640));
		expectInvariant(r);
	});

	it("Every dollar: To assign leads at -8,640 with Take it back", () => {
		const r = run(s("EVERY_DOLLAR", false));
		const v = r.view();
		expect(v.toAssign.poolName).toBe("TO_ASSIGN");
		expect(v.verdict).toMatchObject({
			state: "OVER_ASSIGNED",
			action: "TAKE_BACK",
			lead: { kind: "TO_ASSIGN", amount: { minor: -m(8_640) } },
		});
		expectInvariant(r);
	});
});

describe("S20 first run on the 18th (Jonas, EUR)", () => {
	// EUR 640 in checking now plus 1,660 already spent this month: the
	// starting money is 2,300 at the start of October (02 §6), and the
	// spending logged since the 1st lands in Spending.
	const r = run({
		currency: "EUR",
		start: 202610,
		current: 202610,
		today: "2026-10-18",
		envelopes: [
			{ id: "rent", group: "bills", cats: ["c-rent"] },
			{ id: "spending", group: "spending" },
		],
		defaultEnvelope: "spending",
		moneyIn: [income(202610, 2_300, "STARTING_BALANCE")],
		activity: [
			spend("2026-10-03", 1_000, null),
			spend("2026-10-15", 660, "c-groceries-unlinked"),
		],
		movements: [
			move(202610, null, "spending", 1_800),
			move(202610, null, "rent", 500),
		],
	});

	it("every euro has a job and the budget holds exactly the 640 in checking", () => {
		const v = r.view();
		expect(v.toAssign.amount.minor).toBe(0);
		expect(left(v, "spending")).toBe(m(140));
		expect(left(v, "rent")).toBe(m(500));
		expect(r.sides.ledger).toBe(m(640));
		// 1,660 of 1,800 (92%) by day 18 of 31 (58%).
		expect(v.verdict.state).toBe("FASTER_THAN_PLANNED");
		expectInvariant(r);
	});
});

describe("S13 card spend and S24 many small money-in rows", () => {
	it("S13 a card purchase is ordinary spending; S24 tutoring rows sum into one pool", () => {
		const r = run({
			currency: "MXN",
			start: 202610,
			current: 202610,
			today: "2026-10-20",
			envelopes: [
				{ id: "food", group: "spending", cats: ["c-food"] },
				{ id: "fun", group: "spending" },
			],
			defaultEnvelope: "fun",
			moneyIn: [
				income(202610, 4_000),
				income(202610, 300),
				income(202610, 450),
				income(202610, 600),
			],
			activity: [spend("2026-10-05", 85, "c-food")],
			movements: [move(202610, null, "food", 2_200)],
		});
		const v = r.view();
		// 4,000 + 300 + 450 + 600 - 2,200 = 3,150 in one figure.
		expect(v.toAssign.amount.minor).toBe(m(3_150));
		expect(left(v, "food")).toBe(m(2_115));
		expectInvariant(r);
	});
});

describe("D22 assigning ahead: Fund it now from what I have", () => {
	it("300 assigned into November comes out of October's To assign now", () => {
		const r = run({
			currency: "EUR",
			start: 202610,
			current: 202610,
			today: "2026-10-28",
			envelopes: [
				{ id: "rent", group: "bills" },
				{ id: "spending", group: "spending" },
			],
			defaultEnvelope: "spending",
			moneyIn: [income(202610, 1_000)],
			movements: [move(202611, null, "rent", 300)],
		});
		const oct = r.view();
		expect(oct.toAssign.amount.minor).toBe(m(700));
		expect(oct.toAssign.terms.assignedAhead.minor).toBe(m(300));
		expect(left(oct, "rent")).toBe(0);
		expect(left(r.view(202611), "rent")).toBe(m(300));
		expectInvariant(r);
	});
});

describe("A7 weekly budget (Weekly style)", () => {
	it("150 a week, 100 spent in week 1: 200 left this week, 40 a day until Sunday", () => {
		const r = run({
			currency: "EUR",
			style: "WEEKLY",
			start: 202610,
			current: 202610,
			today: "2026-10-14",
			envelopes: [
				{
					id: "spending",
					group: "spending",
					target: {
						kind: "MONTHLY",
						amount: m(150),
						mode: "REFILL",
						cadence: "WEEK",
					},
				},
			],
			defaultEnvelope: "spending",
			moneyIn: [income(202610, 600)],
			movements: [move(202610, null, "spending", 600)],
			activity: [spend("2026-10-05", 100, null)],
		});
		const v = r.view();
		// October 2026 with Monday weeks has 4 weeks: 150 x 4 = 600, all assigned.
		expect(row(v, "spending").target).toMatchObject({
			amount: { minor: m(600) },
			need: { minor: 0 },
		});
		// Week 2 (Oct 12 to 18): min(Left 500, 150 x 2 - 100) = 200, over 5 days.
		expect(row(v, "spending").leftThisWeek).toMatchObject({
			amount: { minor: m(200) },
			perDay: { minor: m(40) },
			weekIndex: 2,
			resetsOn: "2026-10-19",
		});
		expect(v.verdict).toMatchObject({
			state: "WEEK_LEFT",
			lead: { kind: "LEFT_THIS_WEEK", amount: { minor: m(200) } },
		});
		expectInvariant(r);
	});
});

describe("S5 and C14 splits terms (engine ready for P3)", () => {
	// Asado ARS 90,000 for three, your share 30,000 (Dining); Juan pays his
	// 30,000 back; later Paz's 30,000 is forgiven into Dining.
	const events = [
		{
			kind: "FRONT" as const,
			id: "f-juan",
			counterparty: "juan",
			currency: "ARS",
			date: "2026-10-04",
			month: 202610,
			native: m(30_000),
			value: m(30_000),
		},
		{
			kind: "FRONT" as const,
			id: "f-paz",
			counterparty: "paz",
			currency: "ARS",
			date: "2026-10-04",
			month: 202610,
			native: m(30_000),
			value: m(30_000),
		},
		{
			kind: "RECV" as const,
			id: "r-juan",
			counterparty: "juan",
			currency: "ARS",
			date: "2026-10-11",
			month: 202610,
			native: m(30_000),
			status: "FINALIZED" as const,
			cash: m(30_000),
		},
	];
	const forgive = {
		kind: "FORGIVE" as const,
		id: "fg-paz",
		counterparty: "paz",
		currency: "ARS",
		date: "2026-10-20",
		month: 202610,
		native: m(30_000),
		status: "FINALIZED" as const,
		envelopeId: "dining",
	};
	const s = (withForgive: boolean): Scenario => ({
		currency: "ARS",
		start: 202610,
		current: 202610,
		today: "2026-10-21",
		envelopes: [
			{ id: "dining", group: "spending", cats: ["c-din"] },
			{ id: "spending", group: "spending" },
		],
		defaultEnvelope: "spending",
		moneyIn: [income(202610, 100_000)],
		activity: [spend("2026-10-04", 30_000, "c-din", { source: "SHARE" })],
		splits: replaySplits(withForgive ? [...events, forgive] : events).effects,
	});

	it("S5 fronted 60,000 leaves To assign, Juan's 30,000 returns it: 100,000 - 30,000 held", () => {
		const r = run(s(false));
		const v = r.view();
		expect(v.toAssign.terms.splitsNet.minor).toBe(m(30_000));
		expect(v.toAssign.amount.minor).toBe(m(70_000));
		expect(left(v, "dining")).toBe(-m(30_000));
		expectInvariant(r);
	});

	it("C14 forgiving Paz's 30,000 into Dining: To assign +30,000, Dining -30,000", () => {
		const r = run(s(true));
		const v = r.view();
		expect(v.toAssign.amount.minor).toBe(m(100_000));
		expect(left(v, "dining")).toBe(-m(60_000));
		expectInvariant(r);
	});
});

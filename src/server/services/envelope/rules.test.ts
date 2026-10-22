import { describe, expect, it } from "vitest";
import {
	allocateRules,
	type IncomeRule,
	isRuleEligible,
	type MoneyInRow,
	type MoneyInWithMonth,
	planRuleRun,
	type RecordedRun,
	type RuleLine,
	ruleBatchMonth,
} from "./rules";

const m = (n: number) => Math.round(n * 100);
const T0 = Date.UTC(2026, 9, 1);
const LATER = Date.UTC(2026, 10, 5);

const salary = (
	amount = 2_400_000,
	o: Partial<MoneyInRow> = {},
): MoneyInRow => ({
	id: "in1",
	direction: "IN",
	entryKind: "STANDARD",
	inType: "INCOME",
	keptInWealth: false,
	categoryId: "salary",
	templateId: "tpl-salary",
	title: "Acme salary",
	currency: "ARS",
	bookValue: m(amount),
	createdAtMs: LATER,
	...o,
});

const rule = (
	id: string,
	sortOrder: number,
	envelopeId: string,
	action: IncomeRule["action"],
	o: Partial<IncomeRule> = {},
): IncomeRule => ({
	id,
	sortOrder,
	envelopeId,
	active: true,
	createdAtMs: T0,
	match: { kind: "ANY" },
	action,
	...o,
});

const pct = (bp: number) => ({ kind: "PERCENT" as const, basisPoints: bp });
const amt = (n: number) => ({ kind: "AMOUNT" as const, minor: m(n) });
const rest = { kind: "REMAINDER" as const };

const SAVE_FIRST = [
	rule("save", 1, "savings", pct(2_000)),
	rule("rest", 2, "spending", rest),
];

function lines(out: RuleLine[]) {
	return out.map((l) => [l.envelopeId, l.amount]);
}

describe("allocateRules (SPEC §5.10)", () => {
	it.each<{
		name: string;
		row: MoneyInRow;
		rules: IncomeRule[];
		out: Array<[string, number]>;
	}>([
		{
			name: "Save first preset: 20% to Savings, the rest to Spending (Rules put ARS 480,000 in Savings)",
			row: salary(),
			rules: SAVE_FIRST,
			out: [
				["savings", 480_000],
				["spending", 1_920_000],
			],
		},
		{
			name: "fixed and percent run in sort order, each capped at what is left",
			row: salary(),
			rules: [
				rule("rent", 1, "rent", amt(2_000_000)),
				rule("save", 2, "savings", pct(3_000)),
			],
			out: [
				["rent", 2_000_000],
				["savings", 400_000],
			],
		},
		{
			name: "remainder rules run last whatever their order",
			row: salary(),
			rules: [
				rule("rest", 1, "spending", rest),
				rule("save", 2, "savings", pct(1_000)),
			],
			out: [
				["savings", 240_000],
				["spending", 2_160_000],
			],
		},
		{
			name: "rules never assign more than the money in",
			row: salary(),
			rules: [rule("a", 1, "a", pct(8_000)), rule("b", 2, "b", pct(5_000))],
			out: [
				["a", 1_920_000],
				["b", 480_000],
			],
		},
		{
			name: "a second remainder rule gets nothing",
			row: salary(),
			rules: [rule("r1", 1, "spending", rest), rule("r2", 2, "fun", rest)],
			out: [["spending", 2_400_000]],
		},
		{
			name: "freelancer tax set-aside matches its category only",
			row: salary(900_000, {
				categoryId: "freelance",
				title: "Client payment",
			}),
			rules: [
				rule("tax", 1, "taxes", pct(2_500), {
					match: { kind: "CATEGORY", categoryId: "freelance" },
				}),
			],
			out: [["taxes", 225_000]],
		},
		{
			name: "a category rule ignores other income",
			row: salary(),
			rules: [
				rule("tax", 1, "taxes", pct(2_500), {
					match: { kind: "CATEGORY", categoryId: "freelance" },
				}),
			],
			out: [],
		},
		{
			name: "title contains ignores case and accents",
			row: salary(100_000, { title: "Pagó ACME" }),
			rules: [
				rule("t", 1, "fun", rest, {
					match: { kind: "TITLE", contains: "pago acme" },
				}),
			],
			out: [["fun", 100_000]],
		},
		{
			name: "currency and recurring-template matches",
			row: salary(100_000, { currency: "USD" }),
			rules: [
				rule("usd", 1, "usd-savings", pct(5_000), {
					match: { kind: "CURRENCY", currency: "USD" },
				}),
				rule("tpl", 2, "spending", rest, {
					match: { kind: "TEMPLATE", templateId: "tpl-salary" },
				}),
			],
			out: [
				["usd-savings", 50_000],
				["spending", 50_000],
			],
		},
		{
			name: "a paused rule does nothing",
			row: salary(),
			rules: [rule("save", 1, "savings", pct(2_000), { active: false })],
			out: [],
		},
		{
			name: "a percent rounds half-even to minor units",
			row: salary(0.05),
			rules: [rule("save", 1, "savings", pct(5_000))],
			out: [["savings", 0.02]],
		},
	])("$name", ({ row, rules, out }) => {
		const got = allocateRules(row, rules);
		expect(lines(got)).toEqual(out.map(([e, a]) => [e, m(a)]));
		expect(got.reduce((t, l) => t + l.amount, 0)).toBeLessThanOrEqual(
			row.bookValue ?? 0,
		);
		for (const l of got) expect(l.amount).toBeGreaterThan(0);
	});

	it.each<{ name: string; row: MoneyInRow }>([
		{ name: "a refund", row: salary(100, { inType: "REFUND" }) },
		{
			name: "a starting balance",
			row: salary(100, { entryKind: "STARTING_BALANCE", inType: null }),
		},
		{
			name: "an adjustment",
			row: salary(100, { entryKind: "ADJUSTMENT", inType: null }),
		},
		{ name: "income kept in Wealth", row: salary(100, { keptInWealth: true }) },
		{
			name: "a Not spending transfer",
			row: salary(100, { entryKind: "NOT_SPENDING", inType: null }),
		},
		{
			name: "an expense",
			row: salary(100, { direction: "OUT", inType: null }),
		},
		{
			name: "a row whose rate is missing",
			row: salary(100, { bookValue: null }),
		},
	])("skips $name", ({ row }) => {
		expect(allocateRules(row, SAVE_FIRST)).toEqual([]);
	});

	it("eligibility matches money that enters To assign", () => {
		expect(isRuleEligible(salary())).toBe(true);
		expect(isRuleEligible(salary(1, { keptInWealth: true }))).toBe(false);
	});

	it("a rule only sees money in created after it, unless applied to earlier money in", () => {
		const early = salary(100_000, { createdAtMs: T0 - 1 });
		expect(allocateRules(early, SAVE_FIRST)).toEqual([]);
		expect(
			lines(allocateRules(early, SAVE_FIRST, new Set(["save", "rest"]))),
		).toEqual([
			["savings", m(20_000)],
			["spending", m(80_000)],
		]);
	});
});

describe("planRuleRun (exactly once per change, recorded rules)", () => {
	const NOV = 202611;
	const at = (amount: number, month = NOV, o: Partial<MoneyInRow> = {}) => ({
		...salary(amount, o),
		month,
	});
	/** The record a first run in November leaves: Save first, 480,000 and 1,920,000. */
	const recorded = (o: Partial<RecordedRun> = {}): RecordedRun => ({
		rules: SAVE_FIRST,
		bookValue: m(2_400_000),
		rowMonth: NOV,
		batchMonth: NOV,
		net: [
			{ ruleId: "save", envelopeId: "savings", amount: m(480_000) },
			{ ruleId: "rest", envelopeId: "spending", amount: m(1_920_000) },
		],
		skipped: false,
		...o,
	});
	const paused = [
		rule("save", 1, "savings", pct(2_000), { active: false }),
		rule("rest", 2, "spending", rest),
	];
	const retargeted = [
		rule("save", 1, "house", pct(2_000)),
		rule("rest", 2, "spending", rest),
	];

	it.each<{
		name: string;
		row: MoneyInWithMonth | null;
		rules?: IncomeRule[];
		previous: RecordedRun | null;
		current?: number;
		kind: string;
		batches: Array<[number, Array<[string, number]>]>;
	}>([
		{
			name: "S1 first run writes one RULE batch in the money in's month",
			row: at(2_400_000),
			previous: null,
			kind: "RUN",
			batches: [
				[
					NOV,
					[
						["savings", 480_000],
						["spending", 1_920_000],
					],
				],
			],
		},
		{
			name: "a row no rule applies to writes nothing",
			row: at(1, NOV, { inType: "REFUND" }),
			previous: null,
			kind: "NONE",
			batches: [],
		},
		{
			name: "the same row read again writes nothing",
			row: at(2_400_000),
			previous: recorded(),
			kind: "NONE",
			batches: [],
		},
		{
			// By hand: 20% of the extra 200,000 is 40,000; the rest 160,000.
			name: "salary edited to 2,600,000 writes a delta batch",
			row: at(2_600_000),
			previous: recorded(),
			kind: "DELTA",
			batches: [
				[
					NOV,
					[
						["savings", 40_000],
						["spending", 160_000],
					],
				],
			],
		},
		{
			name: "pausing a rule never changes a past batch",
			row: at(2_400_000),
			rules: paused,
			previous: recorded(),
			kind: "NONE",
			batches: [],
		},
		{
			name: "retargeting a rule never changes a past batch",
			row: at(2_400_000),
			rules: retargeted,
			previous: recorded(),
			kind: "NONE",
			batches: [],
		},
		{
			name: "deleting every rule never changes a past batch",
			row: at(2_400_000),
			rules: [],
			previous: recorded(),
			kind: "NONE",
			batches: [],
		},
		{
			name: "an edit after a rule was paused reruns with the recorded rules",
			row: at(2_600_000),
			rules: paused,
			previous: recorded(),
			kind: "DELTA",
			batches: [
				[
					NOV,
					[
						["savings", 40_000],
						["spending", 160_000],
					],
				],
			],
		},
		{
			name: "S16 deleting the income reverts its batch",
			row: null,
			previous: recorded(),
			kind: "REVERT",
			batches: [
				[
					NOV,
					[
						["savings", -480_000],
						["spending", -1_920_000],
					],
				],
			],
		},
		{
			name: "moving it to Wealth reverts like a delta",
			row: at(2_400_000, NOV, { keptInWealth: true }),
			previous: recorded(),
			kind: "DELTA",
			batches: [
				[
					NOV,
					[
						["savings", -480_000],
						["spending", -1_920_000],
					],
				],
			],
		},
		{
			name: "an undone batch marks the row rules skipped",
			row: at(2_600_000),
			previous: recorded({ net: [], skipped: true }),
			kind: "NONE",
			batches: [],
		},
		{
			// D22: October closed; the delta lands in December, October is never touched.
			name: "editing money in from a closed month writes the delta in the current month",
			row: at(2_600_000, 202610),
			previous: recorded({ rowMonth: 202610, batchMonth: 202610 }),
			current: 202612,
			kind: "DELTA",
			batches: [
				[
					202612,
					[
						["savings", 40_000],
						["spending", 160_000],
					],
				],
			],
		},
		{
			name: "moving the date from November to December reverts in November and runs in December",
			row: at(2_400_000, 202612),
			previous: recorded(),
			kind: "DELTA",
			batches: [
				[
					NOV,
					[
						["savings", -480_000],
						["spending", -1_920_000],
					],
				],
				[
					202612,
					[
						["savings", 480_000],
						["spending", 1_920_000],
					],
				],
			],
		},
	])("$name", ({ row, rules, previous, current, kind, batches }) => {
		const got = planRuleRun({
			row,
			rules: rules ?? SAVE_FIRST,
			previous,
			currentMonth: current ?? NOV,
		});
		expect(got.kind).toBe(kind);
		expect(got.batches.map((b) => [b.month, lines(b.lines)])).toEqual(
			batches.map(([month, ls]) => [month, ls.map(([e, a]) => [e, m(a)])]),
		);
	});

	it("the first run records the rules that applied, so later rule changes cannot reach it", () => {
		const first = planRuleRun({
			row: at(2_400_000),
			rules: SAVE_FIRST,
			previous: null,
			currentMonth: NOV,
		});
		expect(first.record?.rules.map((r) => r.id)).toEqual(["save", "rest"]);
		const edited = planRuleRun({
			row: at(2_600_000),
			rules: retargeted,
			previous: first.record,
			currentMonth: NOV,
		});
		expect(edited.batches[0]?.lines.map((l) => l.envelopeId)).toEqual([
			"savings",
			"spending",
		]);
		expect(edited.record?.net.map((l) => l.amount)).toEqual([
			m(520_000),
			m(2_080_000),
		]);
	});
});

describe("ruleBatchMonth", () => {
	it.each([
		{ row: 202611, current: 202611, out: 202611, why: "current month" },
		{ row: 202612, current: 202611, out: 202612, why: "next month" },
		{
			row: 202609,
			current: 202611,
			out: 202611,
			why: "a past month goes to the current one",
		},
		{
			row: 202701,
			current: 202611,
			out: 202611,
			why: "two months ahead goes to the current one",
		},
	])("$why", ({ row, current, out }) => {
		expect(ruleBatchMonth(row, current)).toBe(out);
	});
});

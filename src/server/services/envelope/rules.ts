/**
 * Income rules (SPEC §5.10, D71; 02 §2 and §3.5): how one money-in row is
 * shared out to envelopes when it arrives.
 *
 * - Only income that enters To assign runs rules: IN, STANDARD, inType
 *   INCOME, not kept in Wealth. Refunds, starting balance, adjustments and
 *   Not spending rows never do; moves from Wealth are not money-in rows.
 * - A rule sees rows created after it, unless the user chose "Also apply to
 *   this month's money in" for it.
 * - Fixed and percent rules run in sort order, each capped at what is left
 *   of that money in; remainder rules run last. Rules never assign more than
 *   the money in, so they alone never make To assign negative.
 * - Each row runs once (IncomeRuleRun), which records the rules it used. An
 *   edit to the row writes a delta with those recorded rules, a delete
 *   reverts, an undone batch marks the row "rules skipped". Changing a rule
 *   never touches past batches, and no batch lands in a closed month.
 */
import { addMonths } from "./calendar";
import type { Minor, MonthKey } from "./types";
import { percentOf } from "./units";

export type RuleMatch =
	| { kind: "ANY" }
	| { kind: "CATEGORY"; categoryId: string }
	| { kind: "TEMPLATE"; templateId: string }
	| { kind: "TITLE"; contains: string }
	| { kind: "CURRENCY"; currency: string };

export type RuleAction =
	| { kind: "PERCENT"; basisPoints: number }
	| { kind: "AMOUNT"; minor: Minor }
	| { kind: "REMAINDER" };

export interface IncomeRule {
	id: string;
	sortOrder: number;
	envelopeId: string;
	active: boolean;
	createdAtMs: number;
	match: RuleMatch;
	action: RuleAction;
}

export interface MoneyInRow {
	id: string;
	direction: "IN" | "OUT";
	entryKind: "STANDARD" | "STARTING_BALANCE" | "ADJUSTMENT" | "NOT_SPENDING";
	inType: "INCOME" | "REFUND" | null;
	/** Income kept in Wealth (`assetAccountId` set) enters the budget only when moved in. */
	keptInWealth: boolean;
	categoryId: string | null;
	templateId: string | null;
	title: string;
	currency: string;
	/** Book value in H minor units (valuation.ts); null while its rate is missing. */
	bookValue: Minor | null;
	createdAtMs: number;
}

export interface RuleLine {
	ruleId: string;
	envelopeId: string;
	/** Positive for a run; signed in deltas and reverts. */
	amount: Minor;
}

/** True for income rows that enter To assign (SPEC §5.10 "When they run"). */
export function isRuleEligible(row: MoneyInRow): boolean {
	return (
		row.direction === "IN" &&
		row.entryKind === "STANDARD" &&
		row.inType === "INCOME" &&
		!row.keptInWealth
	);
}

/** Case- and accent-insensitive text, as search does (RC-10). */
function fold(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function ruleMatches(match: RuleMatch, row: MoneyInRow): boolean {
	switch (match.kind) {
		case "ANY":
			return true;
		case "CATEGORY":
			return row.categoryId === match.categoryId;
		case "TEMPLATE":
			return row.templateId === match.templateId;
		case "TITLE":
			return fold(row.title).includes(fold(match.contains));
		case "CURRENCY":
			return row.currency === match.currency;
	}
}

function ruleApplies(
	rule: IncomeRule,
	row: MoneyInRow,
	appliedToEarlier: ReadonlySet<string>,
) {
	if (!rule.active || !ruleMatches(rule.match, row)) return false;
	return row.createdAtMs > rule.createdAtMs || appliedToEarlier.has(rule.id);
}

function byOrder(a: IncomeRule, b: IncomeRule) {
	return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The rules that apply to a row on its first run, in the order they run. */
export function applicableRules(
	row: MoneyInRow,
	rules: readonly IncomeRule[],
	appliedToEarlier: ReadonlySet<string> = new Set(),
): IncomeRule[] {
	return rules
		.filter((r) => ruleApplies(r, row, appliedToEarlier))
		.sort(byOrder);
}

/** Runs `rules` (already chosen and ordered) on one row: fixed and percent first, remainders last. */
function allocateWith(
	row: MoneyInRow,
	rules: readonly IncomeRule[],
): RuleLine[] {
	if (!isRuleEligible(row) || row.bookValue == null || row.bookValue <= 0)
		return [];
	const matching = rules.filter((r) => ruleMatches(r.match, row));
	const fixed = matching.filter((r) => r.action.kind !== "REMAINDER");
	const remainder = matching.filter((r) => r.action.kind === "REMAINDER");
	let left = row.bookValue;
	const lines: RuleLine[] = [];
	for (const rule of [...fixed, ...remainder]) {
		const a = rule.action;
		const want =
			a.kind === "PERCENT"
				? percentOf(row.bookValue, a.basisPoints)
				: a.kind === "AMOUNT"
					? a.minor
					: left;
		const amount = Math.min(left, Math.max(0, want));
		if (amount <= 0) continue;
		lines.push({ ruleId: rule.id, envelopeId: rule.envelopeId, amount });
		left -= amount;
	}
	return lines;
}

/**
 * The lines one money-in row produces on its first run. `appliedToEarlier`
 * holds rules the user also applied to money in from before the rule existed.
 */
export function allocateRules(
	row: MoneyInRow,
	rules: readonly IncomeRule[],
	appliedToEarlier: ReadonlySet<string> = new Set(),
): RuleLine[] {
	return allocateWith(row, applicableRules(row, rules, appliedToEarlier));
}

/** The month a rule batch is written to: the money in's month if current or next, else the current month. */
export function ruleBatchMonth(
	rowMonth: MonthKey,
	currentMonth: MonthKey,
): MonthKey {
	return rowMonth === currentMonth || rowMonth === addMonths(currentMonth, 1)
		? rowMonth
		: currentMonth;
}

export type RuleRunKind = "NONE" | "RUN" | "DELTA" | "REVERT";

/** What IncomeRuleRun keeps for a row: the rule set of its first run and where its batches stand. */
export interface RecordedRun {
	/** The rules that applied on the first run, as they were then, in run order. */
	rules: readonly IncomeRule[];
	/** The row as last run: book value and budget month. */
	bookValue: Minor | null;
	rowMonth: MonthKey;
	/** Month of the row's latest batch. */
	batchMonth: MonthKey;
	/** Σ of the row's RULE batches so far. */
	net: readonly RuleLine[];
	/** An undone batch marked the row "rules skipped". */
	skipped: boolean;
}

export interface RuleBatch {
	month: MonthKey;
	lines: RuleLine[];
}

export interface RuleRunPlan {
	kind: RuleRunKind;
	batches: RuleBatch[];
	/** What to store on IncomeRuleRun after writing the batches. */
	record: RecordedRun | null;
}

export type MoneyInWithMonth = MoneyInRow & { month: MonthKey };

const lineKey = (l: RuleLine) => `${l.ruleId}\u0000${l.envelopeId}`;

/** new - old per (rule, envelope), zero lines dropped. */
function diffLines(
	next: readonly RuleLine[],
	previous: readonly RuleLine[],
): RuleLine[] {
	const sums = new Map<string, RuleLine>();
	const add = (l: RuleLine, sign: 1 | -1) => {
		const k = lineKey(l);
		const cur = sums.get(k) ?? {
			ruleId: l.ruleId,
			envelopeId: l.envelopeId,
			amount: 0,
		};
		cur.amount += sign * l.amount;
		sums.set(k, cur);
	};
	for (const l of previous) add(l, -1);
	for (const l of next) add(l, 1);
	return [...sums.values()].filter((l) => l.amount !== 0);
}

function firstRun(
	row: MoneyInWithMonth | null,
	p: Parameters<typeof planRuleRun>[0],
): RuleRunPlan {
	if (!row) return { kind: "NONE", batches: [], record: null };
	const rules = applicableRules(row, p.rules, p.appliedToEarlier);
	const lines = allocateWith(row, rules);
	const month = ruleBatchMonth(row.month, p.currentMonth);
	const record = {
		rules,
		bookValue: row.bookValue,
		rowMonth: row.month,
		batchMonth: month,
		net: lines,
		skipped: false,
	};
	return lines.length
		? { kind: "RUN", batches: [{ month, lines }], record }
		: { kind: "NONE", batches: [], record };
}

/**
 * What to write for one money-in row now (SPEC §5.10). The first run uses
 * the rules that apply then and records them. Later runs happen only when
 * the row itself changes (amount, date, deleted, no longer income in the
 * budget) and use the recorded rules, so pausing, deleting or retargeting a
 * rule never changes past batches. Batches go to the row's month when it is
 * the current or next month, else to the current month (D22: a closed month
 * never gets a movement). A row moved to another month reverts in the old
 * batch's month and runs again in the new one.
 */
export function planRuleRun(p: {
	row: MoneyInWithMonth | null;
	/** Current rules; read only on the row's first run. */
	rules: readonly IncomeRule[];
	previous: RecordedRun | null;
	currentMonth: MonthKey;
	appliedToEarlier?: ReadonlySet<string>;
}): RuleRunPlan {
	const prev = p.previous;
	if (!prev) return firstRun(p.row, p);
	if (prev.skipped) return { kind: "NONE", batches: [], record: prev };
	const next = p.row ? allocateWith(p.row, prev.rules) : [];
	const from = ruleBatchMonth(prev.batchMonth, p.currentMonth);
	const to = p.row ? ruleBatchMonth(p.row.month, p.currentMonth) : from;
	const batches: RuleBatch[] =
		from === to
			? [{ month: to, lines: diffLines(next, prev.net) }]
			: [
					{ month: from, lines: diffLines([], prev.net) },
					{ month: to, lines: next },
				];
	const written = batches.filter((b) => b.lines.length > 0);
	if (written.length === 0) return { kind: "NONE", batches: [], record: prev };
	const record = p.row
		? {
				...prev,
				bookValue: p.row.bookValue,
				rowMonth: p.row.month,
				batchMonth: to,
				net: next,
			}
		: null;
	return { kind: p.row ? "DELTA" : "REVERT", batches: written, record };
}

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
 * - Each row runs once (IncomeRuleRun). An edit writes a delta batch, a
 *   delete reverts the batch, an undone batch marks the row "rules skipped".
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

/**
 * The lines one money-in row produces. `appliedToEarlier` holds rules the
 * user also applied to money in that arrived before the rule existed.
 */
export function allocateRules(
	row: MoneyInRow,
	rules: readonly IncomeRule[],
	appliedToEarlier: ReadonlySet<string> = new Set(),
): RuleLine[] {
	if (!isRuleEligible(row) || row.bookValue == null || row.bookValue <= 0)
		return [];
	const applicable = rules
		.filter((r) => ruleApplies(r, row, appliedToEarlier))
		.sort(byOrder);
	const fixed = applicable.filter((r) => r.action.kind !== "REMAINDER");
	const remainder = applicable.filter((r) => r.action.kind === "REMAINDER");
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

/**
 * What to write for one money-in row now (exactly once per change):
 * - no previous run: RUN the rules;
 * - the row was deleted: REVERT what earlier batches assigned (UNDO rows);
 * - rules were skipped (an undone batch): NONE;
 * - otherwise a DELTA between the rules now and what earlier batches net to.
 * `previous.net` is the sum of the row's earlier RULE batches.
 */
export function planRuleRun(p: {
	row: MoneyInRow | null;
	rules: readonly IncomeRule[];
	previous: { net: readonly RuleLine[]; skipped: boolean } | null;
	appliedToEarlier?: ReadonlySet<string>;
}): { kind: RuleRunKind; lines: RuleLine[] } {
	if (p.previous?.skipped) return { kind: "NONE", lines: [] };
	const next = p.row ? allocateRules(p.row, p.rules, p.appliedToEarlier) : [];
	if (!p.previous)
		return next.length
			? { kind: "RUN", lines: next }
			: { kind: "NONE", lines: [] };
	const lines = diffLines(next, p.previous.net);
	if (lines.length === 0) return { kind: "NONE", lines };
	return { kind: p.row ? "DELTA" : "REVERT", lines };
}

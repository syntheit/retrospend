/**
 * Targets (SPEC §5.4, 02 §3.5): this month's need per envelope kind, savings
 * progress, bill cycles, auto-fill and plan cost. All amounts are H minor
 * units; a target in another currency is converted at today's rate by the
 * caller first (valuation.convertToBook, D25).
 *
 * | Kind     | Need this month |
 * |----------|-----------------|
 * | MONTHLY  | REFILL: max(0, X_m - (carry + assigned)); SET_ASIDE: max(0, X_m - assigned) |
 * | BILL     | max(0, ceil((A - carry) / monthsLeft) - assigned), months inclusive to the due month |
 * | SAVINGS  | by which two of amount, date, monthly are set (savingsNeed) |
 * | NONE     | 0 |
 */
import { addDays, addMonths, addMonthsToDate, monthsBetween } from "./calendar";
import {
	type EnvelopeKind,
	type IsoDate,
	type Minor,
	type MonthKey,
	type TargetCadence,
	TargetConfigError,
	type TargetMode,
} from "./types";
import { ceilDiv, sumMinor } from "./units";

export interface MonthlyTarget {
	amount: Minor;
	mode: TargetMode;
	cadence: TargetCadence;
}

/** X_m: X for a monthly target, X x weeks of the month for a weekly one. */
export function monthlyTargetFor(
	t: MonthlyTarget,
	weeksInMonth: number,
): Minor {
	return t.cadence === "WEEK" ? t.amount * weeksInMonth : t.amount;
}

export function monthlyNeed(
	t: MonthlyTarget,
	m: { weeksInMonth: number; carryIn: Minor; assigned: Minor },
): Minor {
	const x = monthlyTargetFor(t, m.weeksInMonth);
	const held = t.mode === "REFILL" ? m.carryIn + m.assigned : m.assigned;
	return Math.max(0, x - held);
}

/** Months from `month` to `dueMonth`, both included; never below 1. */
export function monthsLeftInclusive(
	month: MonthKey,
	dueMonth: MonthKey,
): number {
	return Math.max(1, monthsBetween(month, dueMonth) + 1);
}

export function billNeed(b: {
	amount: Minor;
	month: MonthKey;
	dueMonth: MonthKey;
	carryIn: Minor;
	assigned: Minor;
}): Minor {
	const toGo = b.amount - b.carryIn;
	if (toGo <= 0) return 0;
	const perMonth = ceilDiv(toGo, monthsLeftInclusive(b.month, b.dueMonth));
	return Math.max(0, perMonth - b.assigned);
}

export interface BillCycleInput {
	amount: Minor;
	/** The anchor due date: the template's nextDueDate when linked (D26). */
	nextDue: IsoDate;
	/** Months between dues; null for a one-off bill. */
	repeatMonths: number | null;
	monthStart: IsoDate;
	today: IsoDate;
	/** Follows a recurring expense: stays open until it posts or 7 days pass (D26). */
	linkedToTemplate: boolean;
	/** Activity in this envelope since the previous due date. */
	paidThisCycle: Minor;
}

export const BILL_GRACE_DAYS = 7;

/** True when the cycle's activity reached 90% of the amount (paid early, S9). */
export function paidEnough(paid: Minor, amount: Minor): boolean {
	return amount > 0 && paid * 10 >= amount * 9;
}

/**
 * The due date D' this month's bill need aims at (02 §3.5): the next due on
 * or after the month start; a linked bill still inside its 7-day grace keeps
 * its late due date; a cycle already paid to 90% advances one repeat.
 */
export function billCycle(b: BillCycleInput): { due: IsoDate; done: boolean } {
	let k = 0;
	const dueAt = (i: number) =>
		b.repeatMonths ? addMonthsToDate(b.nextDue, i * b.repeatMonths) : b.nextDue;
	const inGrace = (d: IsoDate) =>
		b.linkedToTemplate && b.today <= addDays(d, BILL_GRACE_DAYS);
	if (b.repeatMonths) {
		while (dueAt(k) < b.monthStart && !inGrace(dueAt(k))) k++;
	}
	if (!paidEnough(b.paidThisCycle, b.amount))
		return { due: dueAt(k), done: false };
	if (!b.repeatMonths) return { due: b.nextDue, done: true };
	return { due: dueAt(k + 1), done: false };
}

/** Savings progress counts money moved to Wealth (SPEC §5.4, B12, D47). */
export function savingsProgress(s: {
	left: Minor;
	toWealth: Minor;
	fromWealth: Minor;
	/** Value today in H of a Wealth account marked "Only for this goal". */
	dedicatedAccountValue?: Minor | null;
}): Minor {
	if (s.dedicatedAccountValue != null) return s.left + s.dedicatedAccountValue;
	return s.left + s.toWealth - s.fromWealth;
}

export interface SavingsTarget {
	/** A in H at today's rate (A_H). */
	amount?: Minor | null;
	dueMonth?: MonthKey | null;
	monthly?: Minor | null;
}

export type SavingsShape =
	| "AMOUNT_DATE"
	| "AMOUNT_MONTHLY"
	| "MONTHLY_DATE"
	| "AMOUNT_ONLY";

/** Which two of amount, date and monthly are set (D48); anything else is invalid. */
export function savingsShape(t: SavingsTarget): SavingsShape {
	const a = t.amount != null;
	const d = t.dueMonth != null;
	const m = t.monthly != null;
	if (a && d && !m) return "AMOUNT_DATE";
	if (a && m && !d) return "AMOUNT_MONTHLY";
	if (m && d && !a) return "MONTHLY_DATE";
	if (a && !d && !m) return "AMOUNT_ONLY";
	throw new TargetConfigError(
		"a savings goal sets any two of amount, date and monthly, or the amount alone",
	);
}

export interface SavingsResult {
	need: Minor;
	/** AMOUNT_MONTHLY: the month the goal is reached at this pace. */
	projectedMonth?: MonthKey;
	/** MONTHLY_DATE: what the goal holds at its date at this pace. */
	totalAtDue?: Minor;
}

/** Savings goal need this month and the solved variable (SPEC §5.4 table). */
export function savingsNeed(
	t: SavingsTarget,
	s: { month: MonthKey; progress: Minor; assigned: Minor },
): SavingsResult {
	const shape = savingsShape(t);
	const pastDue = t.dueMonth != null && s.month > t.dueMonth;
	if (shape === "AMOUNT_ONLY") return { need: 0 };
	if (shape === "AMOUNT_DATE") {
		const toGo = (t.amount as Minor) - s.progress;
		if (pastDue || toGo <= 0) return { need: 0 };
		const months = monthsLeftInclusive(s.month, t.dueMonth as MonthKey);
		return { need: Math.max(0, ceilDiv(toGo, months) - s.assigned) };
	}
	const monthly = t.monthly as Minor;
	if (shape === "MONTHLY_DATE") {
		const need = pastDue ? 0 : Math.max(0, monthly - s.assigned);
		const later = pastDue ? 0 : monthsBetween(s.month, t.dueMonth as MonthKey);
		return { need, totalAtDue: s.progress + need + monthly * later };
	}
	const toGo = (t.amount as Minor) - s.progress;
	const need = Math.max(0, Math.min(monthly, toGo) - s.assigned);
	const after = toGo - need;
	const projectedMonth =
		after <= 0 ? s.month : addMonths(s.month, ceilDiv(after, monthly));
	return { need, projectedMonth };
}

/** History line rule: the goal's A_H moved by more than 5% (SPEC §5.4, B3). */
export function movedMoreThan5Percent(previous: Minor, next: Minor): boolean {
	return Math.abs(next - previous) * 20 > Math.abs(previous);
}

export type FillStep = "OVERSPENT" | "BILL" | "GROUP" | "MONTHLY" | "SAVINGS";

export interface FillCandidate {
	envelopeId: string;
	kind: EnvelopeKind;
	/** Display order within the book (group order, then envelope order). */
	order: number;
	left: Minor;
	need: Minor;
	/** BILL: the cycle's due date. */
	dueDate?: IsoDate | null;
}

export interface GroupExtra {
	/** The group's main envelope (groups.ts). */
	envelopeId: string;
	groupOrder: number;
	need: Minor;
}

export interface FillLine {
	envelopeId: string;
	amount: Minor;
	step: FillStep;
}

function fillQueue(
	cands: readonly FillCandidate[],
	extras: readonly GroupExtra[],
) {
	const byOrder = [...cands].sort((a, b) => a.order - b.order);
	const bills = byOrder
		.filter((c) => c.kind === "BILL")
		.sort(
			(a, b) =>
				(a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
				a.order - b.order,
		);
	const queue: Array<{ envelopeId: string; want: Minor; step: FillStep }> = [];
	for (const c of byOrder)
		if (c.left < 0)
			queue.push({
				envelopeId: c.envelopeId,
				want: -c.left,
				step: "OVERSPENT",
			});
	for (const c of bills)
		queue.push({ envelopeId: c.envelopeId, want: c.need, step: "BILL" });
	for (const g of [...extras].sort((a, b) => a.groupOrder - b.groupOrder)) {
		queue.push({ envelopeId: g.envelopeId, want: g.need, step: "GROUP" });
	}
	for (const kind of ["MONTHLY", "SAVINGS"] as const) {
		for (const c of byOrder)
			if (c.kind === kind)
				queue.push({ envelopeId: c.envelopeId, want: c.need, step: kind });
	}
	return queue;
}

/**
 * Auto-fill (SPEC §5.4): overspent envelopes to 0, bills by due date, group
 * targets in group order, Monthly, then Savings, until `available` runs out.
 * Money that covers an overspend also counts toward that envelope's need,
 * since every need subtracts what is assigned this month.
 */
export function autoFill(
	available: Minor,
	candidates: readonly FillCandidate[],
	groupExtras: readonly GroupExtra[] = [],
): { lines: FillLine[]; left: Minor } {
	let left = Math.max(0, available);
	const covered = new Map<string, Minor>();
	const lines: FillLine[] = [];
	for (const item of fillQueue(candidates, groupExtras)) {
		const cover =
			item.step === "OVERSPENT" ? 0 : (covered.get(item.envelopeId) ?? 0);
		const amount = Math.min(left, Math.max(0, item.want - cover));
		if (amount <= 0) continue;
		lines.push({ envelopeId: item.envelopeId, amount, step: item.step });
		if (item.step === "OVERSPENT") covered.set(item.envelopeId, amount);
		left -= amount;
	}
	return { lines, left };
}

export type PlanCostTarget =
	| { kind: "MONTHLY"; target: MonthlyTarget; weeksInMonth: number }
	| {
			kind: "BILL";
			amount: Minor;
			repeatMonths: number | null;
			needThisMonth: Minor;
	  }
	| { kind: "SAVINGS"; monthlyNeed: Minor }
	| { kind: "NONE" };

/** Monthly equivalent of one target (SPEC §5.13 plan cost). */
export function monthlyEquivalent(t: PlanCostTarget): Minor {
	if (t.kind === "MONTHLY") return monthlyTargetFor(t.target, t.weeksInMonth);
	if (t.kind === "BILL")
		return t.repeatMonths ? ceilDiv(t.amount, t.repeatMonths) : t.needThisMonth;
	if (t.kind === "SAVINGS") return t.monthlyNeed;
	return 0;
}

/**
 * Plan cost: Σ monthly equivalents, where a group counts its own target
 * when that is larger than its children (SPEC §5.13, E6).
 */
export function planCost(
	envelopes: ReadonlyArray<{
		id: string;
		groupId: string | null;
		target: PlanCostTarget;
	}>,
	groupTargets: ReadonlyMap<string, Minor>,
): { total: Minor; byGroup: Map<string | null, Minor> } {
	const children = new Map<string | null, Minor[]>();
	for (const e of envelopes) {
		const list = children.get(e.groupId) ?? [];
		list.push(monthlyEquivalent(e.target));
		children.set(e.groupId, list);
	}
	for (const g of groupTargets.keys())
		if (!children.has(g)) children.set(g, []);
	const byGroup = new Map<string | null, Minor>();
	for (const [g, list] of children) {
		const own = sumMinor(list);
		const target = g === null ? 0 : (groupTargets.get(g) ?? 0);
		byGroup.set(g, Math.max(own, target));
	}
	return { total: sumMinor(byGroup.values()), byGroup };
}

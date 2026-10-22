/**
 * Target needs (SPEC §5.4, 02 §3.5): this month's need per envelope kind and
 * savings progress. All amounts are H minor units; a target in another
 * currency is converted at today's rate by the caller first
 * (valuation.convertToBook, D25). Bill cycles, auto-fill and plan cost live
 * in bill-cycle.ts, auto-fill.ts and plan-cost.ts.
 *
 * | Kind     | Need this month |
 * |----------|-----------------|
 * | MONTHLY  | REFILL: max(0, X_m - (carry + assigned)); SET_ASIDE: max(0, X_m - assigned) |
 * | BILL     | max(0, ceil((A - carry) / monthsLeft) - assigned), months inclusive to the due month |
 * | SAVINGS  | by which two of amount, date, monthly are set (savingsNeed) |
 * | NONE     | 0 |
 */
import { addMonths, monthsBetween } from "./calendar";
import {
	type Minor,
	type MonthKey,
	type TargetCadence,
	TargetConfigError,
	type TargetMode,
} from "./types";
import { ceilDiv } from "./units";

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

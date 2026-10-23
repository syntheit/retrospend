/**
 * This month's target for one envelope (SPEC §5.4): the need plus the facts
 * its one-sentence math reads ("USD 1,200 by May 15. 7 months left. USD
 * 171.43 a month."). The client builds the sentence from these numbers; it
 * never computes one (R9). Builds on targets.ts and bill-cycle.ts.
 *
 * A target counts from its start month (`startMonth`, set when the target
 * was set or edited): earlier months need nothing, so adding a target never
 * makes the past look underfunded.
 */
import { billCycle } from "./bill-cycle";
import { addMonthsToDate } from "./calendar";
import {
	billNeed,
	monthlyNeed,
	monthlyTargetFor,
	monthsLeftInclusive,
	savingsNeed,
} from "./targets";
import type {
	IsoDate,
	Minor,
	MonthKey,
	TargetCadence,
	TargetMode,
} from "./types";
import { ceilDiv } from "./units";

export type EnvelopeTarget =
	| {
			kind: "MONTHLY";
			amount: Minor;
			mode: TargetMode;
			cadence: TargetCadence;
	  }
	| {
			kind: "BILL";
			amount: Minor;
			/** Anchor due date: the template's next due when linked (D26). */
			dueDate: IsoDate;
			repeatMonths: number | null;
			linkedToTemplate: boolean;
	  }
	| {
			kind: "SAVINGS";
			amount: Minor | null;
			dueMonth: MonthKey | null;
			monthly: Minor | null;
	  };

export interface TargetContext {
	month: MonthKey;
	monthFrom: IsoDate;
	today: IsoDate;
	weeksInMonth: number;
	carryIn: Minor;
	assigned: Minor;
	left: Minor;
	/** Σ moved from this envelope to Wealth minus Σ moved back into it, through this month (B12). */
	movedToWealth?: Minor;
	/** Budget month of a date (BookPeriod boundaries). */
	monthOf: (date: IsoDate) => MonthKey;
	/** Spending in this envelope after `fromExclusive` through today (positive). */
	spentSince: (fromExclusive: IsoDate) => Minor;
}

export interface TargetResult {
	need: Minor;
	/** MONTHLY: X_m (X x weeks for a weekly target). BILL: the cycle amount. SAVINGS: A. */
	amount: Minor | null;
	/** BILL: the due date this month aims at. */
	dueDate: IsoDate | null;
	/** BILL and dated SAVINGS: months from this one to the due month, inclusive. */
	monthsLeft: number | null;
	/** BILL and SAVINGS with a date: the even monthly share from this month. */
	perMonth: Minor | null;
	/** SAVINGS: Left plus money moved to Wealth (P4 adds the Wealth part). */
	progress: Minor | null;
	/** SAVINGS amount and monthly: the month the goal is reached. */
	projectedMonth: MonthKey | null;
	/** SAVINGS monthly and date: what the goal holds at its date. */
	totalAtDue: Minor | null;
	/** BILL: this cycle is paid (90% rule, S9). */
	paid: boolean;
}

const EMPTY: TargetResult = {
	need: 0,
	amount: null,
	dueDate: null,
	monthsLeft: null,
	perMonth: null,
	progress: null,
	projectedMonth: null,
	totalAtDue: null,
	paid: false,
};

function billResult(
	t: Extract<EnvelopeTarget, { kind: "BILL" }>,
	c: TargetContext,
): TargetResult {
	const base = {
		amount: t.amount,
		nextDue: t.dueDate,
		repeatMonths: t.repeatMonths,
		monthStart: c.monthFrom,
		today: c.today,
		linkedToTemplate: t.linkedToTemplate,
	};
	const open = billCycle({ ...base, paidThisCycle: 0 });
	const previous = t.repeatMonths
		? addMonthsToDate(open.due, -t.repeatMonths)
		: "0000-01-01";
	const cycle = billCycle({ ...base, paidThisCycle: c.spentSince(previous) });
	if (cycle.done)
		return { ...EMPTY, amount: t.amount, dueDate: cycle.due, paid: true };
	const dueMonth = c.monthOf(cycle.due);
	const monthsLeft = monthsLeftInclusive(c.month, dueMonth);
	return {
		...EMPTY,
		need: billNeed({
			amount: t.amount,
			month: c.month,
			dueMonth,
			carryIn: c.carryIn,
			assigned: c.assigned,
		}),
		amount: t.amount,
		dueDate: cycle.due,
		monthsLeft,
		perMonth: ceilDiv(Math.max(0, t.amount - c.carryIn), monthsLeft),
		paid: cycle.due !== open.due,
	};
}

function savingsResult(
	t: Extract<EnvelopeTarget, { kind: "SAVINGS" }>,
	c: TargetContext,
): TargetResult {
	if (t.amount == null && t.monthly == null) return EMPTY;
	// Money moved to Wealth for the goal still counts as saved (B12, D47).
	const progress = c.left + (c.movedToWealth ?? 0);
	const s = savingsNeed(
		{ amount: t.amount, dueMonth: t.dueMonth, monthly: t.monthly },
		{ month: c.month, progress, assigned: c.assigned },
	);
	const dated = t.dueMonth != null && c.month <= t.dueMonth;
	const monthsLeft = dated
		? monthsLeftInclusive(c.month, t.dueMonth as MonthKey)
		: null;
	const start = progress - c.assigned;
	return {
		...EMPTY,
		need: s.need,
		amount: t.amount,
		monthsLeft,
		perMonth:
			t.amount != null && monthsLeft
				? ceilDiv(Math.max(0, t.amount - start), monthsLeft)
				: t.monthly,
		progress,
		projectedMonth: s.projectedMonth ?? null,
		totalAtDue: s.totalAtDue ?? null,
	};
}

/** The target this month, or null for an envelope without one. */
export function evaluateTarget(
	target: EnvelopeTarget | null,
	startMonth: MonthKey | null,
	c: TargetContext,
): TargetResult | null {
	if (!target) return null;
	if (startMonth != null && c.month < startMonth) return EMPTY;
	if (target.kind === "MONTHLY") {
		return {
			...EMPTY,
			need: monthlyNeed(target, c),
			amount: monthlyTargetFor(target, c.weeksInMonth),
		};
	}
	if (target.kind === "BILL") return billResult(target, c);
	return savingsResult(target, c);
}

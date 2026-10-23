/**
 * The verdict: the top of Budget and Home's budget card (SYNTHESIS-r6 §4,
 * D-owner-2026-10-22d to f), ported from the kit's `BudgetPlan.verdict(ym)`.
 * One number, one state (the first that applies), at most one notice. The
 * client turns the state into its sentence; every figure in it is here.
 *
 * Styles P2 completes: Flex (default), Every dollar and Weekly. Other styles
 * read as Flex until their phase lands.
 */
import type { LeftToSpend } from "./pace";
import type { IsoDate, Minor, MonthKey } from "./types";

export type BudgetStyle =
	| "LIMITS"
	| "FLEX"
	| "EVERY_DOLLAR"
	| "SAVE_FIRST"
	| "FIFTY_THIRTY_TWENTY"
	| "WEEKLY"
	| "DEBT_PAYOFF";

export type VerdictState =
	| "PLANNED_TOO_MUCH"
	| "OVER_BUDGET"
	| "BILLS_SHORT"
	| "USED_UP"
	| "FASTER_THAN_PLANNED"
	| "SOME_OVER"
	| "ON_TRACK"
	| "ALL_ASSIGNED"
	| "NEEDS_JOB"
	| "OVER_ASSIGNED"
	| "WEEK_LEFT"
	| "WEEK_USED";

export type VerdictAction =
	| "FIX_PLAN"
	| "COVER"
	| "PLAN_BILLS"
	| "USE_PLAN"
	| "TAKE_BACK";

export type PoolName = "NOT_PLANNED_YET" | "TO_ASSIGN";

export interface Verdict {
	style: BudgetStyle;
	month: MonthKey;
	lead: {
		kind: "LEFT_TO_SPEND" | "TO_ASSIGN" | "LEFT_THIS_WEEK" | "LEFT_IN_LIMITS";
		figureId: string;
		amount: Minor;
	};
	state: VerdictState;
	perDay: Minor;
	daysLeft: number;
	over: Minor;
	overEnvelopes: Array<{ id: string; over: Minor }>;
	billsShort: Minor;
	plannedTooMuch: Minor;
	resetsOn: IsoDate | null;
	action: VerdictAction | null;
	notice: {
		kind: "NOT_PLANNED_YET" | "OVERSPENT";
		amount: Minor;
		action: VerdictAction;
	} | null;
	poolName: PoolName;
	/** Limits: the month's limits and their spending; null in other styles. */
	limits: { limit: Minor; spent: Minor } | null;
}

/** Envelopes with a limit in a Limits book, this month (SPEC §6.1). */
export interface LimitTotals {
	limit: Minor;
	spent: Minor;
	/** Σ Left of the limited envelopes: "Left in your limits". */
	left: Minor;
	/** Spent a larger share of the limits than of the month (pace). */
	aheadOfPace: boolean;
}

export interface WeekTotals {
	left: Minor;
	perDay: Minor;
	daysLeftInWeek: number;
	resetsOn: IsoDate | null;
}

/** "To assign" only in Every dollar; "Not planned yet" everywhere else (D-owner-2026-10-22f). */
export function poolNameFor(style: BudgetStyle): PoolName {
	return style === "EVERY_DOLLAR" ? "TO_ASSIGN" : "NOT_PLANNED_YET";
}

export const FIGURE_LEFT_TO_SPEND = "budget.leftToSpend";
export const FIGURE_NOT_PLANNED_YET = "budget.notPlannedYet";
export const FIGURE_LEFT_THIS_WEEK = "budget.leftThisWeek";
export const FIGURE_LEFT_IN_LIMITS = "budget.leftInLimits";

/** Limits: To assign stays hidden, so the state reads the limits only (SPEC §5.6). */
function limitsState(l: LimitTotals, overTotal: Minor) {
	if (l.left < 0) return { state: "OVER_BUDGET", action: "COVER" } as const;
	if (l.left === 0) return { state: "USED_UP", action: null } as const;
	if (l.aheadOfPace)
		return { state: "FASTER_THAN_PLANNED", action: null } as const;
	if (overTotal > 0) return { state: "SOME_OVER", action: null } as const;
	return { state: "ON_TRACK", action: null } as const;
}

function flexState(l: LeftToSpend, overTotal: Minor) {
	if (l.plannedTooMuch > 0)
		return { state: "PLANNED_TOO_MUCH", action: "FIX_PLAN" } as const;
	if (l.left < 0) return { state: "OVER_BUDGET", action: "COVER" } as const;
	if (l.billsShort > 0)
		return { state: "BILLS_SHORT", action: "PLAN_BILLS" } as const;
	if (l.left === 0) return { state: "USED_UP", action: null } as const;
	if (l.fasterThanPlanned)
		return { state: "FASTER_THAN_PLANNED", action: null } as const;
	if (overTotal > 0) return { state: "SOME_OVER", action: null } as const;
	return { state: "ON_TRACK", action: null } as const;
}

function dollarState(toAssign: Minor) {
	if (toAssign === 0) return { state: "ALL_ASSIGNED", action: null } as const;
	if (toAssign > 0) return { state: "NEEDS_JOB", action: "USE_PLAN" } as const;
	return { state: "OVER_ASSIGNED", action: "TAKE_BACK" } as const;
}

export function verdict(p: {
	style: BudgetStyle;
	month: MonthKey;
	toAssign: Minor;
	leftToSpend: LeftToSpend;
	/** Every envelope over this month, any group (kit `overspent(ym)`). */
	overspent: ReadonlyArray<{ id: string; over: Minor }>;
	/** Weekly envelopes this week, or null when the book has none. */
	week: WeekTotals | null;
	/** Limits books: their limited envelopes this month. */
	limits?: LimitTotals | null;
}): Verdict {
	const l = p.leftToSpend;
	const overTotal = p.overspent.reduce((t, e) => t + e.over, 0);
	const base = {
		style: p.style,
		month: p.month,
		perDay: l.perDay,
		daysLeft: l.daysLeft,
		over: overTotal,
		overEnvelopes: [...p.overspent],
		billsShort: l.billsShort,
		plannedTooMuch: l.plannedTooMuch,
		resetsOn: null,
		poolName: poolNameFor(p.style),
		limits: null,
	};
	if (p.style === "LIMITS" && p.limits) {
		const lim = p.limits;
		return {
			...base,
			lead: {
				kind: "LEFT_IN_LIMITS",
				figureId: FIGURE_LEFT_IN_LIMITS,
				amount: lim.left,
			},
			...limitsState(lim, overTotal),
			perDay: l.daysLeft > 0 ? Math.floor(Math.max(0, lim.left) / l.daysLeft) : 0,
			// To assign is hidden in a Limits book (SPEC §5.6): no pool notice.
			notice: null,
			limits: { limit: lim.limit, spent: lim.spent },
		};
	}
	const notPlanned =
		l.notPlanned > 0
			? {
					kind: "NOT_PLANNED_YET" as const,
					amount: l.notPlanned,
					action: "USE_PLAN" as const,
				}
			: null;
	if (p.style === "EVERY_DOLLAR") {
		return {
			...base,
			lead: {
				kind: "TO_ASSIGN",
				figureId: FIGURE_NOT_PLANNED_YET,
				amount: p.toAssign,
			},
			...dollarState(p.toAssign),
			notice:
				overTotal > 0
					? { kind: "OVERSPENT", amount: overTotal, action: "COVER" }
					: null,
		};
	}
	if (p.style === "WEEKLY" && p.week) {
		return {
			...base,
			lead: {
				kind: "LEFT_THIS_WEEK",
				figureId: FIGURE_LEFT_THIS_WEEK,
				amount: p.week.left,
			},
			state: p.week.left > 0 ? "WEEK_LEFT" : "WEEK_USED",
			action: null,
			perDay: p.week.perDay,
			daysLeft: p.week.daysLeftInWeek,
			resetsOn: p.week.resetsOn,
			notice: notPlanned,
		};
	}
	return {
		...base,
		lead: {
			kind: "LEFT_TO_SPEND",
			figureId: FIGURE_LEFT_TO_SPEND,
			amount: l.left,
		},
		...flexState(l, overTotal),
		notice: notPlanned,
	};
}

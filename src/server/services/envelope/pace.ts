/**
 * Pace (SPEC §5.4 weekly cadence, §6.1 and the owner's r6 Q1 override):
 * weeks of a budget month, Left this week, Left to spend and per-day
 * figures. All amounts are H minor units; dates are calendar dates.
 *
 * - Weeks start on each occurrence of the week start day inside the budget
 *   month; days before the first occurrence join week 1, so a month has 4
 *   or 5 weeks (a short transition month may have 1).
 * - LeftThisWeek(e, i) = min(Left(e, m), carry + weekly x i - SpentMonthToDate(e)).
 * - Left to spend = Σ Left of the Spending group minus a negative To
 *   assign (D-owner-2026-10-22d, overriding §6.1). Bills show on their own
 *   line.
 */
import { addDays, dayOfWeek, daysBetween } from "./calendar";
import type { IsoDate, Minor } from "./types";
import { mulDiv, sumMinor } from "./units";

export interface BudgetWeek {
	/** 1-based. */
	index: number;
	from: IsoDate;
	to: IsoDate;
}

/** Week start day from the locale: Sunday for en-US, Monday otherwise (SPEC §5.1). */
export function defaultWeekStartDay(locale: string): number {
	return locale === "en-US" ? 0 : 1;
}

/** The weeks of a budget month running `from` to `to` (both included). */
export function weeksOfMonth(m: {
	from: IsoDate;
	to: IsoDate;
	weekStartDay: number;
}): BudgetWeek[] {
	if (m.to < m.from) throw new RangeError("budget month ends before it starts");
	const starts: IsoDate[] = [];
	for (let d = m.from; d <= m.to; d = addDays(d, 1)) {
		if (dayOfWeek(d) === m.weekStartDay) starts.push(d);
	}
	if (starts.length === 0) return [{ index: 1, from: m.from, to: m.to }];
	starts[0] = m.from;
	return starts.map((from, i) => {
		const next = starts[i + 1];
		return { index: i + 1, from, to: next ? addDays(next, -1) : m.to };
	});
}

/** The week that contains `date`, or null when the date is outside the month. */
export function weekOf(
	date: IsoDate,
	weeks: readonly BudgetWeek[],
): BudgetWeek | null {
	return weeks.find((w) => w.from <= date && date <= w.to) ?? null;
}

/** Days from `today` to `to`, today included; 0 when `to` has passed. */
export function daysLeftIncluding(today: IsoDate, to: IsoDate): number {
	return Math.max(0, daysBetween(today, to) + 1);
}

/** About how much a day: half-even, never negative, 0 with no days left. */
export function perDay(amount: Minor, daysLeft: number): Minor {
	if (daysLeft <= 0 || amount <= 0) return 0;
	return mulDiv(amount, 1, daysLeft);
}

/** LeftThisWeek(e, i) (SPEC §5.4). Earlier weeks' savings roll in; overspending shrinks it. */
export function leftThisWeek(w: {
	left: Minor;
	carryIn: Minor;
	weekly: Minor;
	weekIndex: number;
	spentMonthToDate: Minor;
}): Minor {
	return Math.min(
		w.left,
		w.carryIn + w.weekly * w.weekIndex - w.spentMonthToDate,
	);
}

export interface WeeklyPace {
	week: BudgetWeek;
	weeks: number;
	leftThisWeek: Minor;
	perDay: Minor;
	daysLeftInWeek: number;
	/** First day of the next week ("resets Monday"), or null in the last week. */
	resetsOn: IsoDate | null;
}

/** Weekly pace of one envelope on `today` (row: "Left this week ARS 32,000 · resets Monday"). */
export function weeklyPace(p: {
	today: IsoDate;
	month: { from: IsoDate; to: IsoDate; weekStartDay: number };
	left: Minor;
	carryIn: Minor;
	weekly: Minor;
	spentMonthToDate: Minor;
}): WeeklyPace {
	const weeks = weeksOfMonth(p.month);
	const week = weekOf(p.today, weeks);
	if (!week) throw new RangeError(`${p.today} is outside the budget month`);
	const value = leftThisWeek({ ...p, weekIndex: week.index });
	const daysLeftInWeek = daysLeftIncluding(p.today, week.to);
	const next = weeks[week.index];
	return {
		week,
		weeks: weeks.length,
		leftThisWeek: value,
		perDay: perDay(value, daysLeftInWeek),
		daysLeftInWeek,
		resetsOn: next ? next.from : null,
	};
}

/**
 * Spending faster than planned: the share of the pool spent runs more than
 * 5 points ahead of the share of the month gone (mockup kit threshold).
 */
export function spendingFasterThanPlanned(p: {
	pool: Minor;
	spent: Minor;
	dayOfMonth: number;
	daysInMonth: number;
}): boolean {
	if (p.pool <= 0 || p.daysInMonth <= 0) return false;
	const spentShare = BigInt(p.spent) * BigInt(p.daysInMonth) * 100n;
	const timeShare = BigInt(p.dayOfMonth) * BigInt(p.pool) * 100n;
	return spentShare - timeShare > 5n * BigInt(p.pool) * BigInt(p.daysInMonth);
}

/**
 * The role a group plays in Left to spend: Flex's three rows (owner r5 Q4).
 * The schema has to mark which group is Spending (the kit's "everyday").
 */
export type GroupRole = "BILLS" | "SPENDING" | "SAVINGS" | null;

export interface LeftToSpendEnvelope {
	groupRole: GroupRole;
	carryIn: Minor;
	assigned: Minor;
	activity: Minor;
	left: Minor;
}

export interface LeftToSpend {
	/** The hero: Σ Left of the Spending group + min(0, To assign). */
	left: Minor;
	/** About how much a day: left / daysLeft, half-even, never below 0. */
	perDay: Minor;
	daysLeft: number;
	carry: Minor;
	assigned: Minor;
	/** carry + assigned of the Spending group. */
	pool: Minor;
	/** -Σ activity of the Spending group. */
	spent: Minor;
	/** Σ Left of the Spending group alone (overspent envelopes count negative). */
	spendingLeft: Minor;
	/** What a negative To assign took off ("You planned X more than you have"). */
	plannedTooMuch: Minor;
	/** Σ overspending inside the Spending group ("Over by X" on its row). */
	over: Minor;
	/** max(0, Σ Left of Bills): held for bills, not in the hero. */
	billsHeld: Minor;
	/** What Bills still need this month ("Bills: X still needed"). */
	billsShort: Minor;
	billsCount: number;
	/** max(0, Σ Left of Savings). */
	savings: Minor;
	/** max(0, To assign): the "Not planned yet" notice, never in the hero. */
	notPlanned: Minor;
	fasterThanPlanned: boolean;
}

function roleSum(
	envs: readonly LeftToSpendEnvelope[],
	role: GroupRole,
	pick: (e: LeftToSpendEnvelope) => Minor,
) {
	return sumMinor(envs.filter((e) => e.groupRole === role).map(pick));
}

/**
 * Left to spend per D-owner-2026-10-22d, matching the kit's
 * `BudgetPlan.leftToSpend(ym)`: the Spending group only, minus a negative
 * To assign; bills and savings on their own lines. `billNeeds` are this
 * month's bill needs (targets.billNeed); `today` past the month end reads
 * as the whole month gone.
 */
export function leftToSpend(p: {
	envelopes: readonly LeftToSpendEnvelope[];
	toAssign: Minor;
	billNeeds: Iterable<Minor>;
	month: { from: IsoDate; to: IsoDate };
	today: IsoDate;
	/**
	 * Spending in the Spending group posted by recurring templates (positive).
	 * The pace line leaves it out of both the pool and the spent side, so a
	 * subscription on the 1st never reads as spending too fast (D60).
	 */
	recurringSpent?: Minor;
}): LeftToSpend {
	const envs = p.envelopes;
	const spendingLeft = roleSum(envs, "SPENDING", (e) => e.left);
	const carry = roleSum(envs, "SPENDING", (e) => e.carryIn);
	const assigned = roleSum(envs, "SPENDING", (e) => e.assigned);
	const spent = -roleSum(envs, "SPENDING", (e) => e.activity);
	const left = spendingLeft + Math.min(0, p.toAssign);
	const daysInMonth = daysBetween(p.month.from, p.month.to) + 1;
	const dayOfMonth = Math.min(
		daysInMonth,
		Math.max(0, daysBetween(p.month.from, p.today) + 1),
	);
	const daysLeft = Math.min(
		daysInMonth,
		daysLeftIncluding(p.today, p.month.to),
	);
	const pool = carry + assigned;
	const recurring = p.recurringSpent ?? 0;
	return {
		left,
		perDay: perDay(left, daysLeft),
		daysLeft,
		carry,
		assigned,
		pool,
		spent,
		spendingLeft,
		plannedTooMuch: Math.max(0, -p.toAssign),
		over: roleSum(envs, "SPENDING", (e) => Math.max(0, -e.left)),
		billsHeld: Math.max(
			0,
			roleSum(envs, "BILLS", (e) => e.left),
		),
		billsShort: sumMinor(p.billNeeds),
		billsCount: envs.filter((e) => e.groupRole === "BILLS").length,
		savings: Math.max(
			0,
			roleSum(envs, "SAVINGS", (e) => e.left),
		),
		notPlanned: Math.max(0, p.toAssign),
		fasterThanPlanned:
			left > 0 &&
			spendingFasterThanPlanned({
				pool: pool - recurring,
				spent: spent - recurring,
				dayOfMonth,
				daysInMonth,
			}),
	};
}

/**
 * Pace (SPEC §5.4 weekly cadence, §6.1 and the owner's r6 Q1 override):
 * weeks of a budget month, Left this week, Left to spend and per-day
 * figures. All amounts are H minor units; dates are calendar dates.
 *
 * - Weeks start on each occurrence of the week start day inside the budget
 *   month; days before the first occurrence join week 1, so a month has 4
 *   or 5 weeks (a short transition month may have 1).
 * - LeftThisWeek(e, i) = min(Left(e, m), carry + weekly x i - SpentMonthToDate(e)).
 * - Left to spend = Σ Left of Spending envelopes (Monthly and No target
 *   kinds) minus a negative To assign. Bills show on their own line.
 */
import { addDays, dayOfWeek, daysBetween } from "./calendar";
import type { EnvelopeKind, IsoDate, Minor } from "./types";
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

/** Spending envelopes for Left to spend: Monthly spending and No target (SPEC §6.1). */
export function isSpendingKind(kind: EnvelopeKind): boolean {
	return kind === "MONTHLY" || kind === "NONE";
}

export interface LeftToSpend {
	/** The hero: Σ Left of Spending envelopes + min(0, To assign). */
	left: Minor;
	/** Σ Left of Spending envelopes alone (overspent ones count negative). */
	spendingLeft: Minor;
	/** What a negative To assign took off ("You planned X more than you have"). */
	plannedTooMuch: Minor;
	/** To assign when positive: the "Not planned yet" notice, never in the hero. */
	notPlannedYet: Minor;
}

/** Left to spend per owner r6 Q1 (D-owner-2026-10-22d). */
export function leftToSpend(
	envelopes: ReadonlyArray<{ kind: EnvelopeKind; left: Minor }>,
	toAssign: Minor,
): LeftToSpend {
	const spendingLeft = sumMinor(
		envelopes.filter((e) => isSpendingKind(e.kind)).map((e) => e.left),
	);
	const negative = Math.min(0, toAssign);
	return {
		left: spendingLeft + negative,
		spendingLeft,
		plannedTooMuch: Math.max(0, -toAssign),
		notPlannedYet: Math.max(0, toAssign),
	};
}

/** "Bills: covered" when 0, else "Bills: X still needed": Σ this month's bill needs. */
export function billsStillNeeded(billNeeds: Iterable<Minor>): Minor {
	return sumMinor(billNeeds);
}

/**
 * Spending faster than planned: the share of the pool spent runs more than
 * 5 points ahead of the share of the month gone (mockup kit threshold).
 * `spent` excludes recurring expenses (SPEC §6.1, Copilot pace).
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

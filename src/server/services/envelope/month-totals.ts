/**
 * The month's totals the verdict reads (month-view.ts): Left in your limits
 * with pace, Left this week, and Left to spend. Pure, over the view's rows.
 */
import { daysBetween } from "./calendar";
import type { MonthViewInput, Row } from "./month-view";
import { monthRange } from "./months";
import { type LeftToSpend, leftToSpend, perDay } from "./pace";
import type { Minor } from "./types";
import type { LimitTotals } from "./verdict";

/**
 * Limits (SPEC §6.1): envelopes with a limit or money this month. A limit is
 * what the envelope got this month (carried in plus assigned, which plan
 * funding makes the target), so Left = limit - spent. Ahead of pace when a
 * larger share of the limits is spent than of the month has passed.
 */
export function limitTotals(
	rows: Row[],
	p: MonthViewInput,
): LimitTotals | null {
	if (p.book.style !== "LIMITS") return null;
	const limited = rows.filter(
		(r) => r.env.target !== null || r.m.assigned !== 0 || r.m.carryIn !== 0,
	);
	const limit = limited.reduce((t, r) => t + r.m.carryIn + r.m.assigned, 0);
	const spent = -limited.reduce((t, r) => t + (r.m.activity - r.m.wealth), 0);
	const left = limited.reduce((t, r) => t + r.m.left, 0);
	const range = monthRange(p.month, p.book.periods);
	const days = daysBetween(range.from, range.to) + 1;
	const passed = Math.min(
		days,
		Math.max(0, daysBetween(range.from, p.today) + 1),
	);
	return {
		limit,
		spent,
		left,
		aheadOfPace: limit > 0 && spent * days > limit * passed,
	};
}

export function weekTotals(rows: Row[]) {
	const weekly = rows.filter((r) => r.week);
	if (weekly.length === 0) return null;
	const first = weekly[0]?.week as NonNullable<Row["week"]>;
	const left = weekly.reduce((t, r) => t + (r.week?.leftThisWeek ?? 0), 0);
	return {
		left,
		perDay: perDay(left, first.daysLeftInWeek),
		daysLeftInWeek: first.daysLeftInWeek,
		resetsOn: first.resetsOn,
	};
}

/** Left to spend for the month (D-owner-2026-10-22d) with the recurring part of Spending for the pace line (D60). */
export function leftToSpendFor(
	rows: Row[],
	p: MonthViewInput,
	toAssign: Minor,
): LeftToSpend {
	const role = new Map(p.book.groups.map((g) => [g.id, g.role]));
	const roleOf = (r: Row) =>
		r.env.groupId ? (role.get(r.env.groupId) ?? null) : null;
	const range = monthRange(p.month, p.book.periods);
	return leftToSpend({
		envelopes: rows.map((r) => ({
			groupRole: roleOf(r),
			carryIn: r.m.carryIn,
			assigned: r.m.assigned,
			activity: r.m.activity,
			left: r.m.left,
			wealth: r.m.wealth,
		})),
		toAssign,
		billNeeds: rows
			.filter((r) => roleOf(r) === "BILLS")
			.map((r) => r.target?.need ?? 0),
		month: range,
		today: p.today,
		recurringSpent: -rows
			.filter((r) => roleOf(r) === "SPENDING")
			.reduce((t, r) => t + r.m.recurring, 0),
	});
}

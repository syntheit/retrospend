/**
 * Budget insights (the Budget page): spending against the plan for one
 * month, the envelopes furthest over and with the most room, and the last
 * months' spending. Pure over the month reads the page already shows
 * (GetMonthOutput), so every figure agrees with the table beside it.
 */
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { BudgetInsights } from "~/lib/schemas/envelope-insights";
import { monthParts } from "./calendar";
import type { MonthKey } from "./types";

/** How many months the trend looks back, this one included. */
export const TREND_MONTHS = 6;
const LIST = 3;

/** The month before `key` (202601 is preceded by 202512). */
export function previousMonth(key: MonthKey): MonthKey {
	const { year, month } = monthParts(key);
	return month === 1 ? (year - 1) * 100 + 12 : key - 1;
}

/** The months the trend covers: up to TREND_MONTHS, never before the book started. */
export function trendMonths(key: MonthKey, startMonth: MonthKey): MonthKey[] {
	const out: MonthKey[] = [];
	let m = key;
	while (out.length < TREND_MONTHS && m >= startMonth) {
		out.unshift(m);
		m = previousMonth(m);
	}
	return out;
}

const basisOf = (spent: number, held: number): number | null =>
	held > 0 ? Math.min(10_000, Math.round((spent * 10_000) / held)) : null;

/** One month's spending against its plan, over the envelopes that spend (a savings goal does not). */
export function spendingOf(month: GetMonthOutput) {
	const spenders = month.groups
		.flatMap((g) => g.envelopes)
		.filter((e) => e.spentBasis !== null);
	const held = (e: (typeof spenders)[number]) =>
		e.carryIn.minor + e.assigned.minor;
	const planned = spenders.reduce((t, e) => t + held(e), 0);
	const spent = spenders.reduce((t, e) => t + e.spent.minor, 0);
	return { spenders, planned, spent };
}

export function insightsOf(
	month: GetMonthOutput,
	earlier: readonly GetMonthOutput[],
): BudgetInsights {
	const currency = month.book.currency;
	const money = (minor: number) => ({ minor, currency });
	const { spenders, planned, spent } = spendingOf(month);
	const mostOver = spenders
		.filter((e) => e.left.minor < 0)
		.sort((a, b) => a.left.minor - b.left.minor)
		.slice(0, LIST)
		.map((e) => ({ id: e.id, name: e.name, over: money(-e.left.minor) }));
	const mostRoom = spenders
		.filter((e) => e.left.minor > 0)
		.sort((a, b) => b.left.minor - a.left.minor)
		.slice(0, LIST)
		.map((e) => ({
			id: e.id,
			name: e.name,
			left: money(e.left.minor),
			basis: e.spentBasis,
		}));
	const months = [...earlier, month];
	return {
		month: month.month.key,
		planned: money(planned),
		spent: money(spent),
		basis: basisOf(spent, planned),
		over: spent > planned,
		mostOver,
		mostRoom,
		trend:
			months.length < 2
				? []
				: months.map((m) => ({
						month: m.month.key,
						spent: money(spendingOf(m).spent),
					})),
		incomplete: month.incomplete,
	};
}

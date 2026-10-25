/**
 * Month by month (mockup `D.months(6)` with `D.spent({month})`): your
 * spending in each of the last fiscal months, with the page's filters.
 * Months are the user's fiscal months (start day and zone), the same
 * periods Home and Budget use, labeled by the calendar month they start in.
 * One load covers the whole window; each row falls into its month by its
 * instant, and each month converts at its own end's rate.
 */
import { shiftMonthStart } from "@retrospend/domain/insights";
import { periodRateDate } from "@retrospend/domain/money";
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { getCurrentFiscalMonth, getFiscalMonthRange } from "~/lib/fiscal-month";
import type { FigureDb } from "~/server/figures/registry";
import { spentItems } from "~/server/services/figures/spent";
import {
	type InsightsContext,
	insightsContext,
	spentFilterFor,
	valueIn,
} from "./context";
import {
	INSIGHTS,
	type InsightsFilter,
	type MonthBar,
	type MonthsDTO,
} from "./types";

/** Bars the page shows (the mockup's six). */
export const MONTH_BARS = 6;

/** The month label ("2026-10") of the fiscal month holding `at`. */
export function fiscalMonthLabel(ctx: InsightsContext, at: Date): string {
	return dayKey(
		getCurrentFiscalMonth(at, ctx.startDay, ctx.zone),
		ctx.zone,
	).slice(0, 7);
}

/** Totals of the fiscal months named by `labels` (oldest first), one load. */
export async function loadMonths(
	db: FigureDb,
	ctx: InsightsContext,
	labels: readonly string[],
	filter?: InsightsFilter,
): Promise<{ bars: MonthBar[]; missing: string[] }> {
	const ranges = labels.map((label) =>
		getFiscalMonthRange(
			parseDateOnlyIn(`${label}-01`, ctx.zone),
			ctx.startDay,
			ctx.zone,
		),
	);
	const first = ranges[0];
	const last = ranges.at(-1);
	if (!first || !last) return { bars: [], missing: [] };
	const items = await spentItems(
		db,
		spentFilterFor(
			ctx,
			{ from: dayKey(first.start, ctx.zone), to: dayKey(last.end, ctx.zone) },
			filter,
		),
		"day",
	);
	const missing = new Set<string>();
	const bars = ranges.map((range, i): MonthBar => {
		const inMonth = items.filter(
			(item) =>
				item.date !== null &&
				item.date.getTime() >= range.start.getTime() &&
				item.date.getTime() <= range.end.getTime(),
		);
		const value = valueIn(
			inMonth,
			ctx.home,
			ctx.homeRateAt(periodRateDate(range.end, ctx.now)),
		);
		for (const currency of value.missing) missing.add(currency);
		return {
			month: labels[i] ?? "",
			span: {
				from: dayKey(range.start, ctx.zone),
				to: dayKey(range.end, ctx.zone),
			},
			figure: INSIGHTS.byMonth,
			total: value.money,
		};
	});
	return { bars, missing: [...missing].sort() };
}

export async function monthsIn(
	db: FigureDb,
	userId: string,
	input: {
		/** The range's last day: the bars end at its month, or this month if sooner. */
		readonly to: string;
		readonly count?: number;
		readonly filter?: InsightsFilter;
	},
	options: { timeZone?: string; now?: Date } = {},
): Promise<MonthsDTO> {
	const ctx = await insightsContext(db, userId, options);
	const end = parseDateOnlyIn(input.to, ctx.zone);
	const lastLabel = fiscalMonthLabel(ctx, end < ctx.now ? end : ctx.now);
	const count = input.count ?? MONTH_BARS;
	const labels = Array.from({ length: count }, (_, i) =>
		shiftMonthStart(`${lastLabel}-01`, i - (count - 1)).slice(0, 7),
	);
	const { bars, missing } = await loadMonths(db, ctx, labels, input.filter);
	return { home: ctx.home, months: bars, missingRates: missing };
}

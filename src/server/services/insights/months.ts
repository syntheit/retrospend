/**
 * Month by month (mockup `D.months(6)` with `D.spent({month})`): your
 * spending in each of the last fiscal months, with the page's filters.
 * Months are the user's fiscal months (start day and zone), the same
 * periods Home and Budget use, labeled by the calendar month they start in.
 * One load covers the whole window; each row falls into its month by its
 * instant, and each month converts at its own end's rate.
 */
import { shiftMonthStart } from "@retrospend/domain/insights";
import {
	fiscalMonthLabel,
	monthBarsOf,
	monthsWindow,
} from "@retrospend/domain/insights-compute";
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import type { FigureDb } from "~/server/figures/registry";
import { spentItems } from "~/server/services/figures/spent";
import {
	type InsightsContext,
	insightsContext,
	spentFilterFor,
} from "./context";
import {
	INSIGHTS,
	type InsightsFilter,
	type MonthBar,
	type MonthsDTO,
} from "./types";

export { fiscalMonthLabel };

/** Bars the page shows (the mockup's six). */
export const MONTH_BARS = 6;

/** Totals of the fiscal months named by `labels` (oldest first), one load. */
export async function loadMonths(
	db: FigureDb,
	ctx: InsightsContext,
	labels: readonly string[],
	filter?: InsightsFilter,
): Promise<{ bars: MonthBar[]; missing: string[] }> {
	const window = monthsWindow(ctx, labels);
	if (!window) return { bars: [], missing: [] };
	const items = await spentItems(
		db,
		spentFilterFor(ctx, window.span, filter),
		"day",
	);
	const { bars, missing } = monthBarsOf(items, ctx, window.ranges);
	return {
		bars: bars.map((bar) => ({ ...bar, figure: INSIGHTS.byMonth })),
		missing,
	};
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

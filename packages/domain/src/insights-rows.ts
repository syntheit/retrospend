/**
 * The device loaders of Insights: the same reads the server makes with SQL
 * (src/server/services/insights), made from rows held in memory. Each takes
 * the rows once, groups them the way the SQL does (spent.ts), and hands the
 * items to the shared compute (insights-compute.ts), so a device prints the
 * server's digits.
 *
 * Spending is the one definition (spentInputsFromRows); income is
 * incomeGroupsFromRows. `shareRateFor` prices a share: shareRateOf over the
 * rate rows of the share currencies (captured rate first, else the table on
 * the share's own date); without it only a USD share or a captured rate is
 * priced and the rest stays unpriced (never 1). These are the default view's
 * reads; the page's filters stay on the server.
 */
import type { Span } from "./insights";
import {
	type CashflowRead,
	cashflowOf,
	type InsightsContext,
	instantRange,
	type MonthTotal,
	monthBarsOf,
	monthsWindow,
	type SpanRead,
	spanReadOf,
	type YtdSide,
	ytdSideOf,
} from "./insights-compute";
import type { RateInput } from "./money-dec";
import { incomeItemsOf } from "./spend-pace";
import {
	incomeGroupsFromRows,
	type SpentExpenseRow,
	type SpentItem,
	type SpentRowGrouping,
	type SpentShareRow,
	spentInputsFromRows,
	spentItemsOf,
} from "./spent";

/** The rows an Insights read starts from, and how a share is priced. */
export interface InsightsRows {
	readonly expenses: readonly SpentExpenseRow[];
	readonly shares: readonly SpentShareRow[];
	/** Projects hidden from reports. */
	readonly hiddenProjectIds: readonly string[];
	readonly shareRateFor?: (share: SpentShareRow) => RateInput;
}

/** Your spending in a span, as the SQL loader groups it. */
function spentItemsIn(
	rows: InsightsRows,
	ctx: Pick<InsightsContext, "zone">,
	span: Span,
	by: SpentRowGrouping,
): SpentItem[] {
	const when = instantRange(span, ctx.zone);
	return spentItemsOf(
		spentInputsFromRows({
			expenses: rows.expenses,
			shares: rows.shares,
			hiddenProjectIds: rows.hiddenProjectIds,
			range: { start: when.gte, end: when.lte },
			rateFor: rows.shareRateFor,
			by,
		}),
	);
}

/** One span's spending, totaled and split by category in the home currency (the summary's read). */
export function spanReadFromRows(
	rows: InsightsRows,
	ctx: InsightsContext,
	span: Span,
): SpanRead {
	return spanReadOf(spentItemsIn(rows, ctx, span, "category"), ctx, span);
}

/** One span's spending in home and in USD, split by category (the year to date's read). */
export function ytdSideFromRows(
	rows: InsightsRows,
	ctx: InsightsContext,
	span: Span,
): YtdSide {
	return ytdSideOf(spentItemsIn(rows, ctx, span, "category"), ctx, span);
}

/** The totals of the fiscal months named by `labels` (oldest first), one pass over the rows. */
export function monthsFromRows(
	rows: InsightsRows,
	ctx: InsightsContext,
	labels: readonly string[],
): { bars: MonthTotal[]; missing: string[] } {
	const window = monthsWindow(ctx, labels);
	if (!window) return { bars: [], missing: [] };
	return monthBarsOf(
		spentItemsIn(rows, ctx, window.span, "day"),
		ctx,
		window.ranges,
	);
}

/** Spending and income of one range in the home currency (the cashflow's read). */
export function cashflowFromRows(
	rows: InsightsRows,
	ctx: InsightsContext,
	range: Span,
): CashflowRead {
	const when = instantRange(range, ctx.zone);
	return cashflowOf(
		spentItemsIn(rows, ctx, range, "currency"),
		incomeItemsOf(
			incomeGroupsFromRows(rows.expenses, { start: when.gte, end: when.lte }),
		),
		ctx,
		range,
	);
}

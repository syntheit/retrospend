/**
 * The Insights summary (mockup selectors `D.spent`, compare): your spending
 * over a range in the home currency, by category, against the previous
 * period when asked. Every number is `spentItems` (the one spending
 * definition, the same rows as Activity, Home and Budget) totaled by the
 * totals rule, so the header, the total and the categories agree.
 *
 * The previous period is the fiscal period before for a fiscal period, the
 * whole calendar month before for a whole month, else the same number of days
 * right before it (previousPeriod), in the viewer's calendar days.
 */
import { percentChange, type Span } from "@retrospend/domain/insights";
import type { FigureDb } from "~/server/figures/registry";
import { type SpentItem, spentItems } from "~/server/services/figures/spent";
import {
	type InsightsContext,
	insightsContext,
	previousPeriod,
	spanRate,
	spentFilterFor,
	type Valued,
	valueIn,
} from "./context";
import {
	type CategoryRow,
	INSIGHTS,
	type InsightsFilter,
	type SummaryDTO,
} from "./types";

export interface SpanRead {
	readonly total: Valued;
	/** Expenses behind the total. */
	readonly count: number;
	readonly categories: ReadonlyMap<string | null, Valued>;
}

/** Items grouped by their category (null: none). */
export function groupByCategory(
	items: readonly SpentItem[],
): Map<string | null, SpentItem[]> {
	const groups = new Map<string | null, SpentItem[]>();
	for (const item of items) {
		const list = groups.get(item.categoryId) ?? [];
		list.push(item);
		groups.set(item.categoryId, list);
	}
	return groups;
}

/** One span's spending, totaled and split by category in the home currency. */
export async function readSpan(
	db: FigureDb,
	ctx: InsightsContext,
	span: Span,
	filter?: InsightsFilter,
): Promise<SpanRead> {
	const items = await spentItems(
		db,
		spentFilterFor(ctx, span, filter),
		"category",
	);
	const rate = spanRate(ctx, span);
	return {
		total: valueIn(items, ctx.home, rate),
		count: items.reduce((n, item) => n + item.count, 0),
		categories: new Map(
			[...groupByCategory(items)].map(([id, group]) => [
				id,
				valueIn(group, ctx.home, rate),
			]),
		),
	};
}

/** Largest first, nothing-to-show categories out; categories without a value last. */
function rows(
	current: SpanRead,
	previous: SpanRead | null,
): readonly CategoryRow[] {
	const out: CategoryRow[] = [];
	for (const [categoryId, value] of current.categories) {
		if (value.money && value.money.minor <= 0) continue;
		const before = previous?.categories.get(categoryId)?.money ?? null;
		out.push({
			categoryId,
			figure: INSIGHTS.byCategory,
			value: value.money,
			previous: before,
			changePct:
				previous && value.money && before
					? percentChange(value.money.minor, before.minor)
					: null,
		});
	}
	return out.sort(
		(a, b) =>
			(b.value?.minor ?? Number.NEGATIVE_INFINITY) -
				(a.value?.minor ?? Number.NEGATIVE_INFINITY) ||
			(a.categoryId ?? "").localeCompare(b.categoryId ?? ""),
	);
}

export async function summaryIn(
	db: FigureDb,
	userId: string,
	input: {
		readonly range: Span;
		readonly compare: boolean;
		readonly filter?: InsightsFilter;
	},
	options: { timeZone?: string; now?: Date } = {},
): Promise<SummaryDTO> {
	const ctx = await insightsContext(db, userId, options);
	const previousRange = input.compare ? previousPeriod(ctx, input.range) : null;
	const current = await readSpan(db, ctx, input.range, input.filter);
	const previous = previousRange
		? await readSpan(db, ctx, previousRange, input.filter)
		: null;
	const missing = new Set([
		...current.total.missing,
		...(previous?.total.missing ?? []),
		...[...current.categories.values()].flatMap((v) => v.missing),
	]);
	return {
		home: ctx.home,
		range: input.range,
		previousRange,
		total: { id: INSIGHTS.spent, value: current.total.money },
		previousTotal: previous
			? { id: INSIGHTS.spentPrevious, value: previous.total.money }
			: null,
		changePct:
			current.total.money && previous?.total.money
				? percentChange(current.total.money.minor, previous.total.money.minor)
				: null,
		count: current.count,
		categories: rows(current, previous),
		missingRates: [...missing].sort(),
	};
}

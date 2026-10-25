/**
 * Year to date against the same span last year, by category (mockup
 * `ytdSection`), in the home currency and in USD (Show in USD).
 *
 * The year is the calendar year in the viewer's zone: January 1 to today,
 * against January 1 of last year to the same calendar day (yearToDate).
 * The USD view totals the same rows at their frozen values: each row's
 * stored USD value, or its own amount when it is in USD, never a rate looked
 * up again. A row with no USD value at all makes the USD figure unavailable
 * (null, currency named), never a guess.
 */
import {
	percentChange,
	type Span,
	yearToDate,
} from "@retrospend/domain/insights";
import { USD } from "@retrospend/domain/money";
import { dayKey } from "@retrospend/domain/time-zone";
import type { FigureDb } from "~/server/figures/registry";
import { type SpentItem, spentItems } from "~/server/services/figures/spent";
import {
	type InsightsContext,
	insightsContext,
	spanRate,
	spentFilterFor,
	type Valued,
	valueIn,
} from "./context";
import { groupByCategory } from "./summary";
import {
	type HomeAndUsd,
	INSIGHTS,
	type InsightsFilter,
	type YtdCategoryRow,
	type YtdDTO,
} from "./types";

interface Side {
	readonly total: HomeAndUsd;
	readonly categories: ReadonlyMap<string | null, HomeAndUsd>;
	readonly missing: readonly string[];
}

const NONE: HomeAndUsd = { home: null, usd: null };

/** One span's spending in both currencies, split by category. */
export async function readSide(
	db: FigureDb,
	ctx: InsightsContext,
	span: Span,
	filter?: InsightsFilter,
): Promise<Side> {
	const items = await spentItems(
		db,
		spentFilterFor(ctx, span, filter),
		"category",
	);
	const rate = spanRate(ctx, span);
	const both = (group: readonly SpentItem[]) => {
		const home = valueIn(group, ctx.home, rate);
		const usd = valueIn(group, USD, 1);
		return { value: { home: home.money, usd: usd.money }, home, usd };
	};
	const missing = (...v: Valued[]) => v.flatMap((x) => x.missing);
	const all = both(items);
	return {
		total: all.value,
		categories: new Map(
			[...groupByCategory(items)].map(([id, group]) => [id, both(group).value]),
		),
		missing: [...new Set(missing(all.home, all.usd))].sort(),
	};
}

const change = (a: HomeAndUsd, b: HomeAndUsd, key: keyof HomeAndUsd) => {
	const [now, before] = [a[key], b[key]];
	return now && before ? percentChange(now.minor, before.minor) : null;
};

function rows(current: Side, last: Side): readonly YtdCategoryRow[] {
	const out: YtdCategoryRow[] = [];
	for (const [categoryId, value] of current.categories) {
		const before = last.categories.get(categoryId) ?? NONE;
		// Nothing spent, or refunded to nothing, is not a row.
		if ((value.home?.minor ?? 1) <= 0 && (value.usd?.minor ?? 1) <= 0) continue;
		out.push({
			categoryId,
			figure: INSIGHTS.ytdByCategory,
			usdFigure: INSIGHTS.ytdByCategoryUsd,
			value,
			lastYear: before,
			changePct: change(value, before, "home"),
			usdChangePct: change(value, before, "usd"),
		});
	}
	return out.sort(
		(a, b) =>
			(b.value.home?.minor ?? Number.NEGATIVE_INFINITY) -
				(a.value.home?.minor ?? Number.NEGATIVE_INFINITY) ||
			(b.value.usd?.minor ?? 0) - (a.value.usd?.minor ?? 0) ||
			(a.categoryId ?? "").localeCompare(b.categoryId ?? ""),
	);
}

export async function ytdIn(
	db: FigureDb,
	userId: string,
	input: { readonly filter?: InsightsFilter } = {},
	options: { timeZone?: string; now?: Date } = {},
): Promise<YtdDTO> {
	const ctx = await insightsContext(db, userId, options);
	const { thisYear, lastYear } = yearToDate(dayKey(ctx.now, ctx.zone));
	const current = await readSide(db, ctx, thisYear, input.filter);
	const last = await readSide(db, ctx, lastYear, input.filter);
	return {
		home: ctx.home,
		thisYear,
		lastYear,
		total: {
			home: { id: INSIGHTS.ytd, value: current.total.home },
			usd: { id: INSIGHTS.ytdUsd, value: current.total.usd },
			changePct: change(current.total, last.total, "home"),
			usdChangePct: change(current.total, last.total, "usd"),
		},
		lastYearTotal: {
			home: { id: INSIGHTS.ytdLastYear, value: last.total.home },
			usd: { id: INSIGHTS.ytdLastYearUsd, value: last.total.usd },
		},
		categories: rows(current, last),
		missingRates: [...new Set([...current.missing, ...last.missing])].sort(),
	};
}

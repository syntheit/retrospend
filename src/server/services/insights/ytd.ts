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
import {
	type HomeAndUsd,
	type YtdSide,
	ytdSideOf,
} from "@retrospend/domain/insights-compute";
import { dayKey } from "@retrospend/domain/time-zone";
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
	type YtdCategoryRow,
	type YtdDTO,
} from "./types";

const NONE: HomeAndUsd = { home: null, usd: null };

/** One span's spending in both currencies, split by category. */
export async function readSide(
	db: FigureDb,
	ctx: InsightsContext,
	span: Span,
	filter?: InsightsFilter,
): Promise<YtdSide> {
	const items = await spentItems(
		db,
		spentFilterFor(ctx, span, filter),
		"category",
	);
	return ytdSideOf(items, ctx, span);
}

const change = (a: HomeAndUsd, b: HomeAndUsd, key: keyof HomeAndUsd) => {
	const [now, before] = [a[key], b[key]];
	return now && before ? percentChange(now.minor, before.minor) : null;
};

function rows(current: YtdSide, last: YtdSide): readonly YtdCategoryRow[] {
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
			usdRank: 0,
			changePct: change(value, before, "home"),
			usdChangePct: change(value, before, "usd"),
		});
	}
	const byHome = out.sort(
		(a, b) =>
			(b.value.home?.minor ?? Number.NEGATIVE_INFINITY) -
				(a.value.home?.minor ?? Number.NEGATIVE_INFINITY) ||
			(b.value.usd?.minor ?? 0) - (a.value.usd?.minor ?? 0) ||
			(a.categoryId ?? "").localeCompare(b.categoryId ?? ""),
	);
	// The page shows USD in this order, so the client never compares amounts.
	const byUsd = [...byHome].sort(
		(a, b) =>
			(b.value.usd?.minor ?? Number.NEGATIVE_INFINITY) -
				(a.value.usd?.minor ?? Number.NEGATIVE_INFINITY) ||
			(a.categoryId ?? "").localeCompare(b.categoryId ?? ""),
	);
	return byHome.map((row) => ({ ...row, usdRank: byUsd.indexOf(row) }));
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

/**
 * Insights reads and the figure ids their numbers carry (`data-figure`).
 * A DTO sends facts only: ids, Money, integer percents. Category names and
 * titles are the client's (it has the user's categories), and Money is
 * formatted by the client's one formatter (R9, R10).
 */
import type { Span } from "@retrospend/domain/insights";
import type { Money } from "@retrospend/domain/money-minor";

/** The page's filters, shared by every read. */
export interface InsightsFilter {
	readonly categoryIds?: readonly string[];
	/** `user:<id>`, `shadow:<id>` or `guest:<id>`. */
	readonly personKeys?: readonly string[];
	readonly projectIds?: readonly string[];
}

export const INSIGHTS = {
	spent: "insights.spent",
	spentPrevious: "insights.spentPrevious",
	/** Narrowed by `categoryId`. */
	byCategory: "insights.byCategory",
	/** Narrowed by `month` (a fiscal month label, "2026-10"). */
	byMonth: "insights.byMonth",
	income: "insights.income",
	saved: "insights.saved",
	dailyAverage: "insights.dailyAverage",
	monthlyAverage: "insights.monthlyAverage",
	ytd: "insights.ytd",
	ytdLastYear: "insights.ytdLastYear",
	/** Narrowed by `categoryId`. */
	ytdByCategory: "insights.ytdByCategory",
	ytdUsd: "insights.ytdUsd",
	ytdLastYearUsd: "insights.ytdLastYearUsd",
	/** Narrowed by `categoryId`. */
	ytdByCategoryUsd: "insights.ytdByCategoryUsd",
} as const;

/** A number as the page shows it, tagged with its figure id for the display audit. */
export interface InsightsFigure {
	readonly id: string;
	/** Null when unavailable (a missing rate); never 0 in its place. */
	readonly value: Money | null;
}

export interface CategoryRow {
	/** Null: spending with no category. */
	readonly categoryId: string | null;
	/** The row's figure is `figure` narrowed by `categoryId`. */
	readonly figure: string;
	readonly value: Money | null;
	/** The same category in the previous span; null without Compare or when unavailable. */
	readonly previous: Money | null;
	/** Whole percent, signed; null reads "new" (nothing before to compare with). */
	readonly changePct: number | null;
}

export interface SummaryDTO {
	readonly home: string;
	readonly range: Span;
	/** Null without Compare. */
	readonly previousRange: Span | null;
	readonly total: InsightsFigure;
	readonly previousTotal: InsightsFigure | null;
	readonly changePct: number | null;
	/** Expenses behind the total (a refund nets the amount but is not one). */
	readonly count: number;
	/** Largest first; categories that net to nothing or less are left out. */
	readonly categories: readonly CategoryRow[];
	/** Currencies whose missing rate keeps a number out, named (R14). */
	readonly missingRates: readonly string[];
}

export interface MonthBar {
	/** The fiscal month's label, "2026-10". */
	readonly month: string;
	/** The month's first and last day, to open Activity on it. */
	readonly span: Span;
	readonly figure: string;
	readonly total: Money | null;
}

export interface MonthsDTO {
	readonly home: string;
	/** Oldest first, ending at the month of the range's end (or this month if sooner). */
	readonly months: readonly MonthBar[];
	readonly missingRates: readonly string[];
}

/** One amount in the home currency and the same rows in USD at their frozen values. */
export interface HomeAndUsd {
	readonly home: Money | null;
	readonly usd: Money | null;
}

export interface YtdCategoryRow {
	readonly categoryId: string | null;
	readonly figure: string;
	readonly usdFigure: string;
	readonly value: HomeAndUsd;
	readonly lastYear: HomeAndUsd;
	/** Home change in whole percent; null reads "new". */
	readonly changePct: number | null;
	readonly usdChangePct: number | null;
}

export interface YtdDTO {
	readonly home: string;
	readonly thisYear: Span;
	readonly lastYear: Span;
	readonly total: {
		readonly home: InsightsFigure;
		readonly usd: InsightsFigure;
		readonly changePct: number | null;
		readonly usdChangePct: number | null;
	};
	readonly lastYearTotal: {
		readonly home: InsightsFigure;
		readonly usd: InsightsFigure;
	};
	readonly categories: readonly YtdCategoryRow[];
	readonly missingRates: readonly string[];
}

/**
 * Money in against money out for a range. Filters do not apply: income has
 * no category, so a filtered spend against it would say nothing.
 */
export interface CashflowDTO {
	readonly home: string;
	readonly range: Span;
	readonly income: InsightsFigure;
	/** Income minus spending, signed. */
	readonly saved: InsightsFigure;
	/** Whole percent of income left; null without income or with a figure missing. */
	readonly savingsRatePct: number | null;
	/** Spending per day up to today (the whole range once it is over). */
	readonly dailyAverage: InsightsFigure;
	/** Spending per fiscal period the range touches. */
	readonly monthlyAverage: InsightsFigure;
	readonly missingRates: readonly string[];
}

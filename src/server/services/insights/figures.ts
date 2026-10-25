/**
 * Insights figures (IMPLEMENTATION §2.4): the numbers the Insights page
 * tags with `data-figure`, each with one definition in this folder. The
 * registry reads them for the default view, this fiscal period with no
 * filters; the Insights page reads the same functions (summary, months,
 * ytd, cashflow) for the range and filters in its URL, so a figure id
 * names one definition whatever the filter.
 *
 * - insights.spent, insights.spentPrevious: your spending this period and
 *   the one before (previousPeriod), in the home currency.
 * - insights.byCategory [categoryId]: one category of it (0 when nothing).
 * - insights.byMonth [month]: one fiscal month ("2026-10"; this one when
 *   omitted).
 * - insights.income, insights.saved: money in this period, and money in
 *   minus spending (signed).
 * - insights.dailyAverage, insights.monthlyAverage: spending per elapsed
 *   day, and per fiscal period the range touches.
 * - insights.ytd, insights.ytdLastYear, insights.ytdByCategory
 *   [categoryId]: January 1 to today against the same span last year, in
 *   the home currency; the Usd twins total the same rows at their frozen
 *   USD values.
 *
 * Each is unavailable (null, currencies named) while a rate is missing.
 */
import {
	fiscalPeriodsTouched,
	type Span,
	yearToDate,
} from "@retrospend/domain/insights";
import type { Money } from "@retrospend/domain/money-minor";
import { dayKey } from "@retrospend/domain/time-zone";
import { getCurrentFiscalMonth, getFiscalMonthRange } from "~/lib/fiscal-month";
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
} from "~/server/figures/registry";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { averageOf, daysElapsed, readCashflow, savedOf } from "./cashflow";
import { insightsContext, previousPeriod } from "./context";
import { fiscalMonthLabel, loadMonths } from "./months";
import { readSpan } from "./summary";
import { INSIGHTS } from "./types";
import { readSide } from "./ytd";

/** Loads shared by the figures of one read pass. */
function once<T>(
	pass: FigurePass | undefined,
	key: string,
	load: () => Promise<T>,
) {
	return pass ? pass.once(key, load) : load();
}

async function viewOf(db: FigureDb, userId: string, pass?: FigurePass) {
	return once(pass, `insights:ctx:${userId}`, async () => {
		const ctx = await insightsContext(db, userId);
		const label = getCurrentFiscalMonth(ctx.now, ctx.startDay, ctx.zone);
		const range = getFiscalMonthRange(label, ctx.startDay, ctx.zone);
		const period: Span = {
			from: dayKey(range.start, ctx.zone),
			to: dayKey(range.end, ctx.zone),
		};
		return { ctx, period };
	});
}

type View = Awaited<ReturnType<typeof viewOf>>;

/** A reading, or the unavailable marker naming the currencies that kept it out. */
function reading(
	money: Money | null,
	missing: readonly string[],
): Money | FigureUnavailable {
	return money ?? new FigureUnavailable(missing);
}

const spanFigure = (
	id: string,
	pick: (view: View) => Span,
): FigureDefinition => ({
	id,
	scope: [],
	compute: async (db, scope, pass) => {
		const { ctx, period } = await viewOf(db, scope.userId, pass);
		const span = pick({ ctx, period });
		const read = await once(
			pass,
			`insights:span:${scope.userId}:${span.from}`,
			() => readSpan(db, ctx, span),
		);
		return reading(read.total.money, read.total.missing);
	},
});

const byCategoryFigure: FigureDefinition = {
	id: INSIGHTS.byCategory,
	scope: ["categoryId"],
	compute: async (db, scope, pass) => {
		if (!scope.categoryId) return null;
		const { ctx, period } = await viewOf(db, scope.userId, pass);
		const read = await once(
			pass,
			`insights:span:${scope.userId}:${period.from}`,
			() => readSpan(db, ctx, period),
		);
		const value = read.categories.get(scope.categoryId);
		return value
			? reading(value.money, value.missing)
			: { minor: 0, currency: ctx.home };
	},
};

const byMonthFigure: FigureDefinition = {
	id: INSIGHTS.byMonth,
	scope: ["month"],
	compute: async (db, scope, pass) => {
		const { ctx } = await viewOf(db, scope.userId, pass);
		const month = scope.month ?? fiscalMonthLabel(ctx, ctx.now);
		const { bars, missing } = await loadMonths(db, ctx, [month]);
		return reading(bars[0]?.total ?? null, missing);
	},
};

const cashflowFigure = (
	id: string,
	pick: (
		read: Awaited<ReturnType<typeof readCashflow>>,
		view: View,
	) => Money | null,
): FigureDefinition => ({
	id,
	scope: [],
	compute: async (db, scope, pass) => {
		const { ctx, period } = await viewOf(db, scope.userId, pass);
		const read = await once(pass, `insights:cashflow:${scope.userId}`, () =>
			readCashflow(db, ctx, period),
		);
		return reading(pick(read, { ctx, period }), read.missing);
	},
});

const ytdFigure = (
	id: string,
	side: "thisYear" | "lastYear",
	currency: "home" | "usd",
	byCategory = false,
): FigureDefinition => ({
	id,
	scope: byCategory ? ["categoryId"] : [],
	compute: async (db, scope, pass) => {
		if (byCategory && !scope.categoryId) return null;
		const { ctx } = await viewOf(db, scope.userId, pass);
		const spans = yearToDate(dayKey(ctx.now, ctx.zone));
		const read = await once(pass, `insights:ytd:${scope.userId}:${side}`, () =>
			readSide(db, ctx, spans[side]),
		);
		const value = byCategory
			? (read.categories.get(scope.categoryId ?? "") ?? null)
			: read.total;
		if (byCategory && !value)
			return { minor: 0, currency: currency === "usd" ? "USD" : ctx.home };
		return reading(value?.[currency] ?? null, read.missing);
	},
});

export const insightsFigures: FigureDefinition[] = [
	spanFigure(INSIGHTS.spent, (v) => v.period),
	spanFigure(INSIGHTS.spentPrevious, (v) => previousPeriod(v.ctx, v.period)),
	byCategoryFigure,
	byMonthFigure,
	cashflowFigure(INSIGHTS.income, (r) => r.income),
	cashflowFigure(INSIGHTS.saved, (r) => savedOf(r)),
	cashflowFigure(INSIGHTS.dailyAverage, (r, v) =>
		averageOf(r.spent, daysElapsed(v.period, dayKey(v.ctx.now, v.ctx.zone))),
	),
	cashflowFigure(INSIGHTS.monthlyAverage, (r, v) =>
		averageOf(r.spent, fiscalPeriodsTouched(v.period, v.ctx.startDay)),
	),
	ytdFigure(INSIGHTS.ytd, "thisYear", "home"),
	ytdFigure(INSIGHTS.ytdLastYear, "lastYear", "home"),
	ytdFigure(INSIGHTS.ytdByCategory, "thisYear", "home", true),
	ytdFigure(INSIGHTS.ytdUsd, "thisYear", "usd"),
	ytdFigure(INSIGHTS.ytdLastYearUsd, "lastYear", "usd"),
	ytdFigure(INSIGHTS.ytdByCategoryUsd, "thisYear", "usd", true),
];

/**
 * Insights figures (IMPLEMENTATION §2.4): the numbers the Insights page
 * tags with `data-figure`, each with one definition in this folder. The
 * registry reads them for the default view, this fiscal period with no
 * filters; the Insights page reads the same functions (summary, months,
 * ytd, cashflow) for the range and filters in its URL, so a figure id
 * names one definition whatever the filter.
 *
 * What each figure reads (the span, the side, the unavailable marker) is
 * picked in @retrospend/domain/insights-figures, which a device registry
 * calls too; this file only loads rows once per pass and hands them over.
 * See there for what each id means.
 */
import type { Span } from "@retrospend/domain/insights";
import {
	cashflowPicks,
	cashflowReading,
	categoryReading,
	insightsPeriod,
	insightsYtdSpans,
	monthReading,
	spanReading,
	ytdReading,
} from "@retrospend/domain/insights-figures";
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
} from "~/server/figures/registry";
import { readCashflow } from "./cashflow";
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
		return { ctx, period: insightsPeriod(ctx) };
	});
}

type View = Awaited<ReturnType<typeof viewOf>>;

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
		return spanReading(read);
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
		return categoryReading(read, scope.categoryId, ctx.home);
	},
};

const byMonthFigure: FigureDefinition = {
	id: INSIGHTS.byMonth,
	scope: ["month"],
	compute: async (db, scope, pass) => {
		const { ctx } = await viewOf(db, scope.userId, pass);
		const month = scope.month ?? fiscalMonthLabel(ctx, ctx.now);
		const { bars, missing } = await loadMonths(db, ctx, [month]);
		return monthReading(bars, missing);
	},
};

const cashflowFigure = (
	id: string,
	pick: keyof typeof cashflowPicks,
): FigureDefinition => ({
	id,
	scope: [],
	compute: async (db, scope, pass) => {
		const { ctx, period } = await viewOf(db, scope.userId, pass);
		const read = await once(pass, `insights:cashflow:${scope.userId}`, () =>
			readCashflow(db, ctx, period),
		);
		return cashflowReading(cashflowPicks[pick], read, ctx, period);
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
		const spans = insightsYtdSpans(ctx);
		const read = await once(pass, `insights:ytd:${scope.userId}:${side}`, () =>
			readSide(db, ctx, spans[side]),
		);
		return ytdReading(
			read,
			currency,
			ctx,
			byCategory ? scope.categoryId : undefined,
		);
	},
});

export const insightsFigures: FigureDefinition[] = [
	spanFigure(INSIGHTS.spent, (v) => v.period),
	spanFigure(INSIGHTS.spentPrevious, (v) => previousPeriod(v.ctx, v.period)),
	byCategoryFigure,
	byMonthFigure,
	cashflowFigure(INSIGHTS.income, "income"),
	cashflowFigure(INSIGHTS.saved, "saved"),
	cashflowFigure(INSIGHTS.dailyAverage, "dailyAverage"),
	cashflowFigure(INSIGHTS.monthlyAverage, "monthlyAverage"),
	ytdFigure(INSIGHTS.ytd, "thisYear", "home"),
	ytdFigure(INSIGHTS.ytdLastYear, "lastYear", "home"),
	ytdFigure(INSIGHTS.ytdByCategory, "thisYear", "home", true),
	ytdFigure(INSIGHTS.ytdUsd, "thisYear", "usd"),
	ytdFigure(INSIGHTS.ytdLastYearUsd, "lastYear", "usd"),
	ytdFigure(INSIGHTS.ytdByCategoryUsd, "thisYear", "usd", true),
];

import type { RetrospendClient } from "@retrospend/api-client";
import type { Span } from "@retrospend/domain/insights";
import { filterParams, type InsightsView, isNarrowed, spanOf } from "./view";

type Figures = RetrospendClient["figures"];
export type InsightsSummary = Awaited<ReturnType<Figures["insightsSummary"]>>;
export type InsightsMonths = Awaited<ReturnType<Figures["insightsMonths"]>>;
export type InsightsYtd = Awaited<ReturnType<Figures["insightsYtd"]>>;
export type InsightsCashflow = Awaited<ReturnType<Figures["insightsCashflow"]>>;

export interface InsightsData {
	/** The days the reads cover (All time starts at the oldest spending). */
	span: Span;
	summary: InsightsSummary;
	months: InsightsMonths;
	ytd: InsightsYtd;
	/** Null with a chip set: income has no category, so it would say nothing. */
	cashflow: InsightsCashflow | null;
}

/** Bars in Month by month, as on the web. */
export const MONTH_COUNT = 6;

/** The four reads of the web's Insights page, for one view, in one go. */
export function fetchInsights(
	api: RetrospendClient,
	view: InsightsView,
	today: string,
) {
	return async (): Promise<InsightsData> => {
		const firstDay =
			view.period === "all" ? (await api.figures.firstDay()).day : null;
		const span = spanOf(view.period, today, firstDay);
		const filter = filterParams(view);
		const [summary, months, ytd, cashflow] = await Promise.all([
			api.figures.insightsSummary({
				...span,
				...(view.compare ? { compare: "true" as const } : {}),
				...filter,
			}),
			api.figures.insightsMonths({
				to: span.to,
				count: MONTH_COUNT,
				...filter,
			}),
			api.figures.insightsYtd(filter),
			isNarrowed(view) ? null : api.figures.insightsCashflow(span),
		]);
		return { span, summary, months, ytd, cashflow };
	};
}

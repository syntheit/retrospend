import type { RetrospendClient } from "@retrospend/api-client";
import type { Span } from "@retrospend/domain/insights";
import type { DeviceReads } from "@/data/device-engine";
import {
	DEFAULT_VIEW,
	filterParams,
	type InsightsView,
	isNarrowed,
	spanOf,
} from "./view";

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

/**
 * The device's figures are only checked against the server's, in the
 * background, and only for the default view (this month, everything): the
 * category ids and month labels are the ones the screen lists. It shows the
 * server's numbers (AGENTS 6.1).
 */
function compareWithDevice(
	device: DeviceReads,
	{ summary, months, ytd }: Pick<InsightsData, "summary" | "months" | "ytd">,
) {
	const categoryId = [
		...new Set(
			[...summary.categories, ...ytd.categories].flatMap((c) =>
				c.categoryId === null ? [] : [c.categoryId],
			),
		),
	];
	void device.compare("insights", {
		categoryId,
		month: months.months.map((m) => m.month),
	});
}

const isDefaultView = (view: InsightsView): boolean =>
	view.period === DEFAULT_VIEW.period &&
	view.compare === DEFAULT_VIEW.compare &&
	!isNarrowed(view);

/** The four reads of the web's Insights page, for one view, in one go. */
export function fetchInsights(
	api: RetrospendClient,
	view: InsightsView,
	today: string,
	device?: DeviceReads | null,
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
		if (device && isDefaultView(view))
			compareWithDevice(device, { summary, months, ytd });
		return { span, summary, months, ytd, cashflow };
	};
}

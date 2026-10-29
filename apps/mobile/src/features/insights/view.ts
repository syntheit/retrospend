import {
	lastDayOfMonth,
	type Span,
	shiftMonthStart,
} from "@retrospend/domain/insights";

/**
 * What the Insights chips choose: a period, Compare to the period before,
 * and one category and one person, as on Activity. The default (this month,
 * everything) is the web page with no query.
 */
export type InsightsPeriod = "month" | "lastMonth" | "year" | "all";

export const PERIODS: readonly InsightsPeriod[] = [
	"month",
	"lastMonth",
	"year",
	"all",
];

export interface InsightsView {
	period: InsightsPeriod;
	compare: boolean;
	categoryId: string | null;
	/** A person key, `user:ID`, `shadow:ID` or `guest:ID`. */
	personKey: string | null;
}

export const DEFAULT_VIEW: InsightsView = {
	period: "month",
	compare: false,
	categoryId: null,
	personKey: null,
};

export const isNarrowed = (view: InsightsView): boolean =>
	view.categoryId !== null || view.personKey !== null;

/**
 * The days a period covers, in the phone's calendar. All time runs from the
 * day of the oldest spending (GET /figures/first-day) to today; with no
 * spending it is today.
 */
export function spanOf(
	period: InsightsPeriod,
	today: string,
	firstDay: string | null,
): Span {
	const month = `${today.slice(0, 8)}01`;
	switch (period) {
		case "month":
			return { from: month, to: lastDayOfMonth(month) };
		case "lastMonth": {
			const from = shiftMonthStart(month, -1);
			return { from, to: lastDayOfMonth(from) };
		}
		case "year":
			return {
				from: `${today.slice(0, 4)}-01-01`,
				to: `${today.slice(0, 4)}-12-31`,
			};
		case "all":
			return {
				from: firstDay && firstDay < today ? firstDay : today,
				to: today,
			};
	}
}

/** The chips as the routes' comma-separated lists; nothing picked sends nothing. */
export function filterParams(view: InsightsView): {
	cat?: string;
	person?: string;
} {
	return {
		...(view.categoryId ? { cat: view.categoryId } : {}),
		...(view.personKey ? { person: view.personKey } : {}),
	};
}

/** The cache entry for a view on a day: a new day or a new pick is a new read. */
export function viewKey(view: InsightsView, today: string): string {
	return [
		INSIGHTS_PREFIX,
		today,
		view.period,
		view.compare ? "1" : "0",
		view.categoryId ?? "",
		view.personKey ?? "",
	].join(":");
}

export const INSIGHTS_PREFIX = "insights";

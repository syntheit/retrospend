/**
 * The Insights page's one state, read from and written to the URL (?from=,
 * ?to=, ?range=all, ?compare=1, ?cat=, ?person=, ?project=), so a link into
 * Insights arrives filtered. The summary, the months, the year to date and
 * the cashflow all read this one value.
 */
import type { Span } from "@retrospend/domain/insights";
import type { DateRangeValue } from "~/components/pickers/date-range-model";
import { firstOfMonth, lastOfMonth } from "~/components/pickers/dates";
import { writeFilter } from "~/features/activity/filters";
import type { InsightsFilterInput } from "~/lib/schemas/insights";

export type InsightsDim = "cats" | "people" | "projects";

export type InsightsView = {
	range: DateRangeValue;
	compare: boolean;
	cats: string[];
	people: string[];
	projects: string[];
};

const PARAM: Record<InsightsDim, string> = {
	cats: "cat",
	people: "person",
	projects: "project",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

export function thisMonth(today: string): DateRangeValue {
	return { from: firstOfMonth(today), to: lastOfMonth(today) };
}

/** The view a URL names; with no dates, this month. */
export function readView(params: URLSearchParams, today: string): InsightsView {
	const from = params.get("from");
	const to = params.get("to");
	const range: DateRangeValue =
		params.get("range") === "all"
			? { from: null, to: null }
			: from && to && ISO.test(from) && ISO.test(to) && from <= to
				? { from, to }
				: thisMonth(today);
	return {
		range,
		compare: params.get("compare") === "1",
		cats: list(params.get(PARAM.cats)),
		people: list(params.get(PARAM.people)),
		projects: list(params.get(PARAM.projects)),
	};
}

/** The query string for a view; this month with nothing else is the bare page. */
export function writeView(view: InsightsView, today: string): string {
	const p = new URLSearchParams();
	const month = thisMonth(today);
	const { from, to } = view.range;
	if (!from && !to) p.set("range", "all");
	else if (from !== month.from || to !== month.to) {
		if (from) p.set("from", from);
		if (to) p.set("to", to);
	}
	if (view.compare) p.set("compare", "1");
	for (const dim of Object.keys(PARAM) as InsightsDim[])
		if (view[dim].length) p.set(PARAM[dim], view[dim].join(","));
	return p.toString();
}

/**
 * The span the reads take. All time runs from the day of the oldest spending
 * (a server read, `insights.firstDay`) to today; with no spending it is today.
 */
export function spanOf(
	range: DateRangeValue,
	today: string,
	firstDay: string | null,
): Span {
	return { from: range.from ?? firstDay ?? today, to: range.to ?? today };
}

/** The server's filter for the page's chips; nothing picked is no filter. */
export function filterOf(view: InsightsView): InsightsFilterInput {
	return {
		...(view.cats.length ? { categoryIds: view.cats } : {}),
		...(view.people.length ? { personKeys: view.people } : {}),
		...(view.projects.length ? { projectIds: view.projects } : {}),
	};
}

export const isNarrowed = (view: InsightsView): boolean =>
	view.cats.length + view.people.length + view.projects.length > 0;

/**
 * A link into Activity with this page's filters: the rows behind a number.
 * `cat` narrows to one category, `span` moves to another stretch of days
 * (last period, a month, this year). Activity reads the same parameters.
 */
export function activityHref(
	view: InsightsView,
	today: string,
	narrow: { cat?: string; span?: Span | "all" } = {},
): string {
	const range =
		narrow.span === "all"
			? { from: null, to: null }
			: (narrow.span ?? view.range);
	const qs = writeFilter(
		{
			range,
			cats: narrow.cat ? [narrow.cat] : view.cats,
			people: view.people,
			projects: view.projects,
			paidBy: [],
			kinds: [],
			q: "",
		},
		today,
	);
	return qs ? `/activity?${qs}` : "/activity";
}

/**
 * The Activity filter as one value, read from and written to the URL, so
 * links from Insights, Budget and People arrive pre-filtered (?cat=,
 * ?person=, ?project=, ?paidby=, ?kind=, ?from=, ?to=, ?q=). The list, the
 * count and the footer all read this one value (RC4).
 */

import type { DateRangeValue } from "~/components/pickers/date-range-model";
import { firstOfMonth, lastOfMonth } from "~/components/pickers/dates";
import {
	ACTIVITY_KINDS,
	type ActivityKind,
	type ListV2Input,
} from "~/server/services/expense-list/types";

export type ActivityFilter = {
	range: DateRangeValue;
	cats: string[];
	people: string[];
	projects: string[];
	paidBy: string[];
	kinds: ActivityKind[];
	q: string;
};

export type Dim = "cats" | "people" | "projects" | "paidBy" | "kinds";

const PARAM: Record<Dim, string> = {
	cats: "cat",
	people: "person",
	projects: "project",
	paidBy: "paidby",
	kinds: "kind",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

export function thisMonth(today: string): DateRangeValue {
	return { from: firstOfMonth(today), to: lastOfMonth(today) };
}

/**
 * The filter a URL names. With no dates the range is this month, unless the
 * link searches or picks a category (those cover every month), or says
 * `range=all`.
 */
export function readFilter(
	params: URLSearchParams,
	today: string,
): ActivityFilter {
	const from = params.get("from");
	const to = params.get("to");
	const q = params.get("q") ?? "";
	const wide = params.get("range") === "all" || !!q || params.has("cat");
	const range =
		from || to
			? {
					from: from && ISO.test(from) ? from : null,
					to: to && ISO.test(to) ? to : null,
				}
			: wide
				? { from: null, to: null }
				: thisMonth(today);
	return {
		range,
		cats: list(params.get(PARAM.cats)),
		people: list(params.get(PARAM.people)),
		projects: list(params.get(PARAM.projects)),
		paidBy: list(params.get(PARAM.paidBy)),
		kinds: list(params.get(PARAM.kinds)).filter((k): k is ActivityKind =>
			(ACTIVITY_KINDS as readonly string[]).includes(k),
		),
		q,
	};
}

/** The URL for a filter; this month with nothing else is the bare page. */
export function writeFilter(f: ActivityFilter, today: string): string {
	const p = new URLSearchParams();
	const month = thisMonth(today);
	const isMonth = f.range.from === month.from && f.range.to === month.to;
	const allTime = !f.range.from && !f.range.to;
	for (const dim of Object.keys(PARAM) as Dim[])
		if (f[dim].length) p.set(PARAM[dim], f[dim].join(","));
	if (f.q) p.set("q", f.q);
	const wideByDefault = !!f.q || f.cats.length > 0;
	if (allTime && !wideByDefault) p.set("range", "all");
	else if (!allTime && (!isMonth || wideByDefault)) {
		if (f.range.from) p.set("from", f.range.from);
		if (f.range.to) p.set("to", f.range.to);
	}
	return p.toString();
}

/** The server query for a filter (without the cursor and page size). */
export function queryOf(
	f: ActivityFilter,
): Omit<ListV2Input, "cursor" | "limit"> {
	const q = f.q.trim();
	return {
		...(f.range.from ? { from: f.range.from } : {}),
		...(f.range.to ? { to: f.range.to } : {}),
		...(f.cats.length ? { categoryIds: f.cats } : {}),
		...(f.people.length ? { people: f.people } : {}),
		...(f.projects.length ? { projectIds: f.projects } : {}),
		...(f.paidBy.length ? { paidBy: f.paidBy } : {}),
		...(f.kinds.length ? { kinds: f.kinds } : {}),
		...(q ? { q } : {}),
	};
}

/** Whether anything narrows the list beyond the default month. */
export function isFiltered(f: ActivityFilter, today: string): boolean {
	return writeFilter(f, today) !== "";
}

export function toggled<T extends string>(values: T[], value: T): T[] {
	return values.includes(value)
		? values.filter((v) => v !== value)
		: [...values, value];
}

import type { ActivityKind } from "@retrospend/api-contract";
import { monthDays } from "@/lib/days";

/**
 * What the Activity chips and the search bar choose. The default (this
 * month, everything) is the empty filter: the server reads no dates as this
 * month, as the web does.
 */
export interface ActivityFilter {
	/**
	 * `month` is the server's default (no dates): this month, unless a search or
	 * a category is set, which cover every month. `thisMonth` is this month
	 * asked for on purpose, so it is sent as dates even beside those two.
	 */
	period: "month" | "thisMonth" | "all";
	kind: ActivityKind | null;
	categoryId: string | null;
	/** A person key, `user:ID`, `shadow:ID` or `guest:ID`. */
	personKey: string | null;
	projectId: string | null;
	/** Typed in the search bar; sent as is (the server treats it as opaque). */
	q: string;
}

export const DEFAULT_FILTER: ActivityFilter = {
	period: "month",
	kind: null,
	categoryId: null,
	personKey: null,
	projectId: null,
	q: "",
};

/** A search or a category makes the server list every month. */
function coversEveryMonth(filter: ActivityFilter): boolean {
	return filter.categoryId !== null || filter.q !== "";
}

/**
 * The months the list really covers, for the summary line: "all" when the
 * filter says so or when a search or category widens it (the web's grammar).
 */
export function effectivePeriod(filter: ActivityFilter): "month" | "all" {
	if (filter.period === "all") return "all";
	if (filter.period === "thisMonth") return "month";
	return coversEveryMonth(filter) ? "all" : "month";
}

/** The `filter` query of GET /expenses, in the web's grammar. */
export function filterString(
	filter: ActivityFilter,
	now: Date = new Date(),
): string {
	// Built by hand: React Native's URLSearchParams is not a full one.
	const pairs: [string, string][] = [];
	if (filter.period === "all") pairs.push(["range", "all"]);
	if (filter.period === "thisMonth" && coversEveryMonth(filter)) {
		const days = monthDays(now);
		pairs.push(["from", days.from], ["to", days.to]);
	}
	if (filter.categoryId) pairs.push(["cat", filter.categoryId]);
	if (filter.personKey) pairs.push(["person", filter.personKey]);
	if (filter.projectId) pairs.push(["project", filter.projectId]);
	if (filter.kind) pairs.push(["kind", filter.kind]);
	if (filter.q) pairs.push(["q", filter.q.slice(0, 100)]);
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export function isDefaultFilter(filter: ActivityFilter): boolean {
	return filterString(filter) === "";
}

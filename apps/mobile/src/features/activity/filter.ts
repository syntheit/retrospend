import type { ActivityKind } from "@retrospend/api-contract";

/**
 * What the Activity chips and the search bar choose. The default (this
 * month, everything) is the empty filter: the server reads no dates as this
 * month, as the web does.
 */
export interface ActivityFilter {
	period: "month" | "all";
	kind: ActivityKind | null;
	categoryId: string | null;
	/** A person key, `user:ID`, `shadow:ID` or `guest:ID`. */
	personKey: string | null;
	/** Typed in the search bar; sent as is (the server treats it as opaque). */
	q: string;
}

export const DEFAULT_FILTER: ActivityFilter = {
	period: "month",
	kind: null,
	categoryId: null,
	personKey: null,
	q: "",
};

/** The `filter` query of GET /expenses, in the web's grammar. */
export function filterString(filter: ActivityFilter): string {
	// Built by hand: React Native's URLSearchParams is not a full one.
	const pairs: [string, string][] = [];
	if (filter.period === "all") pairs.push(["range", "all"]);
	if (filter.categoryId) pairs.push(["cat", filter.categoryId]);
	if (filter.personKey) pairs.push(["person", filter.personKey]);
	if (filter.kind) pairs.push(["kind", filter.kind]);
	if (filter.q) pairs.push(["q", filter.q.slice(0, 100)]);
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export function isDefaultFilter(filter: ActivityFilter): boolean {
	return filterString(filter) === "";
}

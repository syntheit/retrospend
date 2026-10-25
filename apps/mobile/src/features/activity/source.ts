import type { RetrospendClient } from "@retrospend/api-client";
import type { ActivityRowDto } from "@retrospend/api-contract";
import type { ReadCache } from "@/data/cache";
import { loadCached, type ReadState } from "@/features/read/loadCached";
import { type ActivityFilter, filterString } from "./filter";

// The Activity list reads GET /expenses (cursor pages, newest first). The
// first page of the unfiltered list is cached so the phone opens offline;
// later pages and filtered lists are read live.

export type ActivityItem = ActivityRowDto;

export type ActivityPage = Awaited<
	ReturnType<RetrospendClient["expenses"]["list"]>
>;

export interface ActivitySource {
	list(query: { cursor?: string; filter?: string }): Promise<ActivityPage>;
}

export const ACTIVITY_CACHE = { name: "activity", schema: 2 } as const;

export function createActivitySource(api: RetrospendClient): ActivitySource {
	return {
		list: ({ cursor, filter }) =>
			api.expenses.list({ cursor, filter: filter || undefined }),
	};
}

export type ActivityState = ReadState<ActivityPage>;

/**
 * The first page. The default filter shows the cache first (offline-first);
 * a chosen filter is read live, and an error with nothing to show.
 */
export async function loadActivity(
	source: ActivitySource,
	cache: ReadCache,
	filter: ActivityFilter,
	onCached: (state: ActivityState) => void,
): Promise<ActivityState> {
	const text = filterString(filter);
	if (text === "") {
		return loadCached(cache, ACTIVITY_CACHE, () => source.list({}), onCached);
	}
	try {
		const data = await source.list({ filter: text });
		return { status: "ready", data, staleSince: null };
	} catch {
		return { status: "error" };
	}
}

/** The next page joins the list; the first page's count and total stay. */
export function appendPage(
	prev: ActivityPage,
	next: ActivityPage,
): ActivityPage {
	const seen = new Set(prev.items.map((item) => item.id));
	return {
		...prev,
		items: [...prev.items, ...next.items.filter((item) => !seen.has(item.id))],
		nextCursor: next.nextCursor,
		dayTotals:
			prev.dayTotals && next.dayTotals
				? { ...prev.dayTotals, ...next.dayTotals }
				: null,
	};
}

import type { RetrospendClient } from "@retrospend/api-client";
import type { Money } from "@retrospend/domain/money-minor";
import type { ReadCache } from "@/data/cache";

// The Activity list reads from API v1. The v1 expense routes (G2) are not on
// this build's contract yet, so the source reports "unavailable" instead of
// inventing data. When G2 lands, only `createActivitySource` changes: call the
// list route, map each row to ActivityItem, return the page. The screen, the
// cache and the row already work with that shape.

export interface ActivityItem {
	id: string;
	/** Free text the person typed; shown as is (the server treats it as opaque). */
	title: string;
	/** What and when, for example "Groceries, Oct 21". */
	subline: string;
	/** The original amount, in its own currency. */
	amount: Money;
	/** The row version for offline edits (`updatedAt`). */
	version: string;
}

export type ActivityPage =
	| { status: "ok"; items: ActivityItem[]; nextCursor: string | null }
	| { status: "unavailable" };

export interface ActivitySource {
	list(cursor?: string): Promise<ActivityPage>;
}

export const ACTIVITY_CACHE = { name: "activity", schema: 1 } as const;

export function createActivitySource(_api: RetrospendClient): ActivitySource {
	return { list: async () => ({ status: "unavailable" }) };
}

export type ActivityState =
	| { status: "loading" }
	| {
			status: "ready";
			items: ActivityItem[] /** When the rows were fetched, if they are from the cache. */;
			staleSince: string | null;
	  }
	| { status: "unavailable" }
	| { status: "error" };

/**
 * Cached rows first (the phone is offline-first), then the server. A failed
 * refresh keeps showing the cache, marked stale; with no cache it is an error.
 */
export async function loadActivity(
	source: ActivitySource,
	cache: ReadCache,
	onCached: (state: ActivityState) => void,
): Promise<ActivityState> {
	const cached = await cache.read<ActivityItem[]>(
		ACTIVITY_CACHE.name,
		ACTIVITY_CACHE.schema,
	);
	if (cached)
		onCached({
			status: "ready",
			items: cached.data,
			staleSince: cached.fetchedAt,
		});
	try {
		const page = await source.list();
		if (page.status === "unavailable") return { status: "unavailable" };
		await cache.write(ACTIVITY_CACHE.name, ACTIVITY_CACHE.schema, page.items);
		return { status: "ready", items: page.items, staleSince: null };
	} catch {
		return cached
			? { status: "ready", items: cached.data, staleSince: cached.fetchedAt }
			: { status: "error" };
	}
}

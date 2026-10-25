import type { ReadCache } from "@/data/cache";

// The phone is offline-first: a screen shows what it cached last time, then
// the server's answer. A failed refresh keeps the cache, marked stale; with
// no cache it is an error. Every read screen sits on this one function.

export interface CacheKey {
	name: string;
	schema: number;
}

export type ReadState<T> =
	| { status: "loading" }
	| {
			status: "ready";
			data: T;
			/**
			 * Set only when the refresh failed: when these rows were fetched.
			 * While the refresh is still on its way nothing says "offline".
			 */
			staleSince: string | null;
			/** The rows are the cache's and the server has not answered yet. */
			refreshing: boolean;
	  }
	| { status: "error" };

/** Per-entity entries (a person, an expense) kept; the oldest go first. */
export const ENTITY_CACHE_LIMIT = 40;

/**
 * `cache` is null when the phone has no store for this account yet (offline
 * with no cached profile): the read goes straight to the server.
 */
export async function loadCached<T>(
	cache: ReadCache | null,
	key: CacheKey,
	fetch: () => Promise<T>,
	onCached: (state: ReadState<T>) => void,
	prune?: { prefix: string; keep: number },
): Promise<ReadState<T>> {
	const cached = cache ? await cache.read<T>(key.name, key.schema) : null;
	if (cached) {
		onCached({
			status: "ready",
			data: cached.data,
			staleSince: null,
			refreshing: true,
		});
	}
	try {
		const data = await fetch();
		if (cache) {
			await cache.write(key.name, key.schema, data);
			if (prune) await cache.prune(prune.prefix, prune.keep);
		}
		return { status: "ready", data, staleSince: null, refreshing: false };
	} catch {
		return cached
			? {
					status: "ready",
					data: cached.data,
					staleSince: cached.fetchedAt,
					refreshing: false,
				}
			: { status: "error" };
	}
}

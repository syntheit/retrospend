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

/** An unchanged payload is written again only this often, so entries age by when they were last read. */
export const REWRITE_AFTER_MS = 60 * 60 * 1000;

const serialized = new WeakMap<object, string>();

function serialize(value: unknown): string {
	if (typeof value !== "object" || value === null) return JSON.stringify(value);
	let text = serialized.get(value);
	if (text === undefined) {
		text = JSON.stringify(value);
		serialized.set(value, text);
	}
	return text;
}

/** Whether two payloads are the same data (the server's answer did not change). */
export function sameData(a: unknown, b: unknown): boolean {
	return a === b || serialize(a) === serialize(b);
}

/**
 * The state to show after `next`: the same state object when nothing a screen
 * draws has changed, and the old rows (same references, so memoized children
 * keep their work) when only a flag did.
 */
export function settle<T>(
	prev: ReadState<T>,
	next: ReadState<T>,
): ReadState<T> {
	if (
		prev.status === "ready" &&
		next.status === "ready" &&
		sameData(prev.data, next.data)
	) {
		return prev.staleSince === next.staleSince &&
			prev.refreshing === next.refreshing
			? prev
			: { ...next, data: prev.data };
	}
	return next;
}

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
	options: {
		/** With rows in the cache, they are the answer: the server is not asked. */
		cachedIsEnough?: boolean;
		now?: () => number;
	} = {},
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
	if (cached && options.cachedIsEnough) {
		return {
			status: "ready",
			data: cached.data,
			staleSince: null,
			refreshing: false,
		};
	}
	try {
		const data = await fetch();
		if (cache) {
			// Same rows as the last write, and written recently: no disk work.
			const age = cached
				? (options.now ?? Date.now)() - Date.parse(cached.fetchedAt)
				: Number.POSITIVE_INFINITY;
			const unchanged =
				cached && age < REWRITE_AFTER_MS && sameData(cached.data, data);
			if (!unchanged) {
				await cache.write(key.name, key.schema, data);
				if (prune) await cache.prune(prune.prefix, prune.keep);
			}
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

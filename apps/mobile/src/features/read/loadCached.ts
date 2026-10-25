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
			/** When the rows were fetched, if they are from the cache. */
			staleSince: string | null;
	  }
	| { status: "error" };

export async function loadCached<T>(
	cache: ReadCache,
	key: CacheKey,
	fetch: () => Promise<T>,
	onCached: (state: ReadState<T>) => void,
): Promise<ReadState<T>> {
	const cached = await cache.read<T>(key.name, key.schema);
	if (cached) {
		onCached({
			status: "ready",
			data: cached.data,
			staleSince: cached.fetchedAt,
		});
	}
	try {
		const data = await fetch();
		await cache.write(key.name, key.schema, data);
		return { status: "ready", data, staleSince: null };
	} catch {
		return cached
			? { status: "ready", data: cached.data, staleSince: cached.fetchedAt }
			: { status: "error" };
	}
}

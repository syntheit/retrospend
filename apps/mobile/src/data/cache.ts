import type { KeyValueStore } from "./store";

// A read cache with a schema version per entry. A payload written by an older
// build, or for a different account, is dropped instead of being trusted.
// Entries also carry the build that wrote them: a payload shape can change
// without anyone bumping its schema number, and a screen that reads the old
// shape crashes on the first frame (build 2202 died on Home that way).

interface Entry<T> {
	schema: number;
	/** The build number that wrote it; absent in entries from before this field. */
	build?: string;
	/** The server clock at the read: the `updatedSince` for the next delta. */
	serverTime: string | null;
	fetchedAt: string;
	data: T;
}

export interface Cached<T> {
	data: T;
	serverTime: string | null;
	fetchedAt: string;
}

export interface ReadCache {
	read<T>(name: string, schema: number): Promise<Cached<T> | null>;
	write<T>(
		name: string,
		schema: number,
		data: T,
		serverTime?: string | null,
	): Promise<void>;
	/**
	 * Keeps the `keep` newest entries whose name starts with `prefix` (one per
	 * person, one per expense) and drops the rest, so a phone that browses a
	 * lot does not grow without bound.
	 */
	prune(prefix: string, keep: number): Promise<void>;
	/** Sign out: nothing from this account stays on the phone. */
	clear(): Promise<void>;
}

/** Per-phone choices kept in the cache that no server answer replaces (Home "later"). */
export const STICKY_CACHE_NAMES: readonly string[] = ["home.later"];

export interface CacheBuild {
	/** The running build: only entries it wrote are read, the others are dropped. */
	build: string;
	/** Names that are the person's own choices, not a server answer: kept across builds. */
	sticky?: readonly string[];
}

/**
 * `scope` is the account (server + user), so two accounts never share rows.
 * With a `binding`, an update starts from the server's answer, never from a
 * payload of the old shape.
 */
export function createReadCache(
	store: KeyValueStore,
	scope: string,
	now: () => Date = () => new Date(),
	binding?: CacheBuild,
): ReadCache {
	const prefix = `cache:${scope}:`;
	return {
		async read<T>(name: string, schema: number) {
			const raw = await store.get(prefix + name);
			if (raw === null) return null;
			try {
				const entry = JSON.parse(raw) as Entry<T>;
				if (
					entry.schema === schema &&
					(!binding ||
						binding.sticky?.includes(name) ||
						entry.build === binding.build)
				) {
					return {
						data: entry.data,
						serverTime: entry.serverTime,
						fetchedAt: entry.fetchedAt,
					};
				}
			} catch {
				// Unreadable entry: a miss, dropped below.
			}
			await store.delete(prefix + name);
			return null;
		},
		async write(name, schema, data, serverTime = null) {
			const entry: Entry<unknown> = {
				schema,
				build: binding?.build,
				serverTime,
				fetchedAt: now().toISOString(),
				data,
			};
			await store.set(prefix + name, JSON.stringify(entry));
		},
		async prune(namePrefix, keep) {
			const keys = await store.keys(prefix + namePrefix);
			if (keys.length <= keep) return;
			const dated = await Promise.all(
				keys.map(async (key) => {
					let at = "";
					try {
						at =
							(JSON.parse((await store.get(key)) ?? "{}") as Entry<unknown>)
								.fetchedAt ?? "";
					} catch {
						// Unreadable: it sorts oldest and goes first.
					}
					return { key, at };
				}),
			);
			dated.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
			for (const { key } of dated.slice(keep)) await store.delete(key);
		},
		async clear() {
			for (const key of await store.keys(prefix)) await store.delete(key);
		},
	};
}

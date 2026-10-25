import type { KeyValueStore } from "./store";

// A read cache with a schema version per entry. A payload written by an older
// build, or for a different account, is dropped instead of being trusted.

interface Entry<T> {
	schema: number;
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
	/** Sign out: nothing from this account stays on the phone. */
	clear(): Promise<void>;
}

/** `scope` is the account (server + user), so two accounts never share rows. */
export function createReadCache(
	store: KeyValueStore,
	scope: string,
	now: () => Date = () => new Date(),
): ReadCache {
	const prefix = `cache:${scope}:`;
	return {
		async read<T>(name: string, schema: number) {
			const raw = await store.get(prefix + name);
			if (raw === null) return null;
			try {
				const entry = JSON.parse(raw) as Entry<T>;
				if (entry.schema === schema) {
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
				serverTime,
				fetchedAt: now().toISOString(),
				data,
			};
			await store.set(prefix + name, JSON.stringify(entry));
		},
		async clear() {
			for (const key of await store.keys(prefix)) await store.delete(key);
		},
	};
}

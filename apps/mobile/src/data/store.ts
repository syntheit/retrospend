// The local store seam. Everything the phone keeps for offline use (the
// read cache, the outbox) sits on this one async key-value interface, so the
// engine is testable with the in-memory store and the app runs on SQLite.

export interface KeyValueStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	/** Every key that starts with the prefix, in ascending order. */
	keys(prefix: string): Promise<string[]>;
}

export function createMemoryStore(): KeyValueStore {
	const map = new Map<string, string>();
	return {
		get: async (key) => map.get(key) ?? null,
		set: async (key, value) => {
			map.set(key, value);
		},
		delete: async (key) => {
			map.delete(key);
		},
		keys: async (prefix) =>
			[...map.keys()].filter((k) => k.startsWith(prefix)).sort(),
	};
}

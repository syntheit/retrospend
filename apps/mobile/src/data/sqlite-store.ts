import Storage from "expo-sqlite/kv-store";
import type { KeyValueStore } from "./store";

/** The app's store: expo-sqlite's key-value table (one SQLite file on the phone). */
export function createSqliteStore(): KeyValueStore {
	return {
		get: (key) => Storage.getItem(key),
		set: (key, value) => Storage.setItem(key, value),
		delete: async (key) => {
			await Storage.removeItem(key);
		},
		keys: async (prefix) =>
			(await Storage.getAllKeys()).filter((k) => k.startsWith(prefix)).sort(),
	};
}

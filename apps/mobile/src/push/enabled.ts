import type { KeyValueStore } from "@/data/store";

// Whether this phone has Push switched on, and for whom. The background task
// has no React tree and no session, so it reads who to poll for from here.
// Present means on; turning Push off, signing out and an ended session
// remove it.

export interface PushEnabled {
	baseUrl: string;
	meId: string;
}

const KEY = "push.enabled";

/** `key` names another background task's record of the same shape (the recurring poster's). */
export function createEnabledStore(store: KeyValueStore, key = KEY) {
	return {
		async get(): Promise<PushEnabled | null> {
			const raw = await store.get(key);
			if (!raw) return null;
			try {
				const v = JSON.parse(raw) as Partial<PushEnabled>;
				return typeof v.baseUrl === "string" && typeof v.meId === "string"
					? { baseUrl: v.baseUrl, meId: v.meId }
					: null;
			} catch {
				return null;
			}
		},
		set: (value: PushEnabled) => store.set(key, JSON.stringify(value)),
		clear: () => store.delete(key),
	};
}

/** The key all the per-account push state is filed under. */
export function pushScope(value: PushEnabled): string {
	return `${value.baseUrl}|${value.meId}`;
}

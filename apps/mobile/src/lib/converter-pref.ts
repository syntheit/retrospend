// Whether Home's top bar shows the currency converter button. It belongs to
// this phone only: nothing is sent to the server. Off by default.

import { useSyncExternalStore } from "react";
import { secureStore } from "./secure-store";

const KEY = "retrospend.show-converter";

let current: boolean | null = null;
const listeners = new Set<() => void>();

/** Read once, synchronously, so Home's first frame already has the right bar. */
export function getShowConverter(): boolean {
	if (current === null) {
		try {
			current = secureStore.getItem(KEY) === "1";
		} catch {
			current = false;
		}
	}
	return current;
}

export function setShowConverter(next: boolean): void {
	current = next;
	for (const listener of listeners) listener();
	// Persisting is best effort: the choice still applies until the app closes.
	secureStore.setItemAsync(KEY, next ? "1" : "0").catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useShowConverter(): boolean {
	return useSyncExternalStore(subscribe, getShowConverter, getShowConverter);
}

/** For tests: forget the cached value so the next read goes to the store. */
export function resetShowConverterCache(): void {
	current = null;
}

// The currencies picked lately in the currency picker, newest first. They
// belong to this phone only: nothing is sent to the server. The composer also
// passes the currencies of the latest entries, which the picker merges in.

import { useSyncExternalStore } from "react";
import { secureStore } from "./secure-store";

const KEY = "retrospend.recent-currencies";
/** How many picks are kept. */
export const RECENT_PICKS = 5;

function parse(raw: string | null | undefined): string[] {
	try {
		const list: unknown = JSON.parse(raw ?? "[]");
		if (!Array.isArray(list)) return [];
		return list
			.filter((c): c is string => typeof c === "string" && c.length > 0)
			.slice(0, RECENT_PICKS);
	} catch {
		return [];
	}
}

let current: string[] | null = null;
const listeners = new Set<() => void>();

/** Read once, synchronously, so the first open already has them. */
export function getRecentCurrencies(): string[] {
	if (current === null) {
		try {
			current = parse(secureStore.getItem(KEY));
		} catch {
			current = [];
		}
	}
	return current;
}

/** Puts a pick first, once, and keeps the last few. */
export function recordRecentCurrency(code: string): void {
	current = [code, ...getRecentCurrencies().filter((c) => c !== code)].slice(
		0,
		RECENT_PICKS,
	);
	for (const listener of listeners) listener();
	// Persisting is best effort: the list still applies until the app closes.
	secureStore.setItemAsync(KEY, JSON.stringify(current)).catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useRecentCurrencies(): string[] {
	return useSyncExternalStore(
		subscribe,
		getRecentCurrencies,
		getRecentCurrencies,
	);
}

/** For tests: forget the cached list so the next read goes to the store. */
export function resetRecentCurrencies(): void {
	current = null;
}

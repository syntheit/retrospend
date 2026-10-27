// The language chosen inside the app. It belongs to this phone only: it is
// never sent to the server, so it does not touch the web language setting.
// "device" (the default) follows the phone, including the per-app language
// the system lets you pick in its own settings.

import { useSyncExternalStore } from "react";
import { APP_LOCALES, type AppLocale } from "./locales";
import { secureStore } from "./secure-store";

export type LanguagePref = AppLocale | "device";

const KEY = "retrospend.language";

function parse(raw: string | null | undefined): LanguagePref {
	return APP_LOCALES.find((l) => l === raw) ?? "device";
}

let current: LanguagePref | null = null;
const listeners = new Set<() => void>();

/** Read once, synchronously, so the first screen already speaks the language. */
export function getLanguagePref(): LanguagePref {
	if (current === null) {
		try {
			current = parse(secureStore.getItem(KEY));
		} catch {
			// An unreadable keystore means following the phone.
			current = "device";
		}
	}
	return current;
}

export function setLanguagePref(next: LanguagePref): void {
	current = next;
	for (const listener of listeners) listener();
	// Persisting is best effort: the choice still applies until the app closes.
	secureStore.setItemAsync(KEY, next).catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useLanguagePref(): LanguagePref {
	return useSyncExternalStore(subscribe, getLanguagePref, getLanguagePref);
}

/** For tests: forget the cached value so the next read goes to the store. */
export function resetLanguagePrefCache(): void {
	current = null;
}

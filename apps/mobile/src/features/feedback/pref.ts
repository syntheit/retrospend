// "Send error reports to my server": off unless the person turns it on. It
// belongs to this phone only, like the language choice, and is read once and
// synchronously so the first screen already shows the right state.

import { useSyncExternalStore } from "react";
import { secureStore } from "@/lib/secure-store";

const KEY = "retrospend.errorReports";

let current: boolean | null = null;
const listeners = new Set<() => void>();

export function getErrorReportsPref(): boolean {
	if (current === null) {
		try {
			current = secureStore.getItem(KEY) === "on";
		} catch {
			// An unreadable keystore means off, the safe default.
			current = false;
		}
	}
	return current;
}

export function setErrorReportsPref(on: boolean): void {
	current = on;
	for (const listener of listeners) listener();
	secureStore.setItemAsync(KEY, on ? "on" : "off").catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useErrorReportsPref(): boolean {
	return useSyncExternalStore(
		subscribe,
		getErrorReportsPref,
		getErrorReportsPref,
	);
}

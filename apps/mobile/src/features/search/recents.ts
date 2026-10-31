import Storage from "expo-sqlite/kv-store";
import { addRecent, parseRecents } from "./rules";

const KEY = "ui.search.recent";

/** The searches you ran lately, newest first. A failed read is an empty list. */
export function readRecents(): string[] {
	try {
		return parseRecents(Storage.getItemSync(KEY));
	} catch {
		return [];
	}
}

/** Remembers one search and returns the new list. */
export function rememberSearch(query: string): string[] {
	const next = addRecent(readRecents(), query);
	try {
		Storage.setItemSync(KEY, JSON.stringify(next));
	} catch {
		// Recent searches are a convenience; the screen works without them.
	}
	return next;
}

export function clearRecents(): void {
	try {
		Storage.removeItemSync(KEY);
	} catch {
		// Nothing to clear if the store is unreachable.
	}
}

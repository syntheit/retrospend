import { useEffect, useState } from "react";

/** How long the search bar waits after a keystroke before the list asks. */
export const SEARCH_DELAY_MS = 300;

/**
 * The text of a search bar, and `onQuery` told of it once typing pauses: the
 * bar sends text as it is typed, the list asks once.
 */
export function useDebouncedSearch(onQuery: (q: string) => void) {
	const [search, setSearch] = useState("");
	// biome-ignore lint/correctness/useExhaustiveDependencies: only the text restarts the wait
	useEffect(() => {
		const timer = setTimeout(() => onQuery(search), SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	}, [search]);
	return [search, setSearch] as const;
}

import { useFocusEffect } from "expo-router";
import { type RefObject, useCallback, useRef } from "react";
import type { SearchBarCommands } from "react-native-screens";

type SearchRef = RefObject<SearchBarCommands | null>;

/** The search bar of the screen in front, the one Cmd+F reaches. */
let current: SearchRef | null = null;

/** Puts the cursor in the current screen's search bar; false when it has none. */
export function focusSearch(): boolean {
	const bar = current?.current;
	if (!bar) return false;
	bar.focus();
	return true;
}

/**
 * A ref for `headerSearchBarOptions.ref`. While the screen is focused, Cmd+F
 * focuses its search bar; a screen that is not in front gives the key up, so
 * a tab you left never takes it. `owner` is false for a part of a screen
 * whose parent holds the search bar.
 */
export function useSearchShortcut(owner = true): SearchRef {
	const ref = useRef<SearchBarCommands | null>(null);
	useFocusEffect(
		useCallback(() => {
			// A list inside a hub does not own the search bar; the hub does.
			if (!owner) return;
			current = ref;
			return () => {
				if (current === ref) current = null;
			};
		}, [owner]),
	);
	return ref;
}

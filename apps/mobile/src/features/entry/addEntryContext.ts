import { useFocusEffect } from "expo-router";
import {
	createContext,
	type Dispatch,
	type SetStateAction,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import {
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Platform,
} from "react-native";
import type { ComposerPrefill } from "@/surfaces/prefill";
import { nextExpanded } from "./fabScroll";
import type { EntryMode } from "./types";

// The add button's context, apart from the provider: screens and lists reach
// it through here without loading the composer.

export interface AddEntryApi {
	/** Opens the composer sheet, optionally filled in by a share, a Shortcut or a link. */
	open(mode?: EntryMode, prefill?: ComposerPrefill): void;
	/** Opens the composer on a saved expense (its id); Save replaces it, and Undo restores it. */
	edit(entryId: string, kind?: "shared"): void;
	/**
	 * Hides the floating add button until the returned function is called (the
	 * entry page, where the entry is the subject). Counts, so two pages
	 * hiding it at once both have to let go.
	 */
	hideButton(): () => void;
	/** Android: sets whether the floating button shows its label (extended) or only the plus. */
	setButtonExpanded: Dispatch<SetStateAction<boolean>>;
}

export const AddEntryContext = createContext<AddEntryApi | null>(null);

export function useAddEntry(): AddEntryApi {
	const value = useContext(AddEntryContext);
	if (!value) throw new Error("useAddEntry needs an AddEntryProvider above it");
	return value;
}

/**
 * Hides the floating add button while the calling screen is on top. A route
 * under a pushed page, or in another tab, is still mounted but not focused,
 * and must not hide the button there.
 */
export function useHideAddButton(hidden = true): void {
	const add = useOptionalAddEntry();
	useFocusEffect(
		useCallback(() => {
			if (!hidden || !add) return;
			return add.hideButton();
		}, [add, hidden]),
	);
}

/** Like useAddEntry, but null outside a provider (the gallery has none). */
export function useOptionalAddEntry(): AddEntryApi | null {
	return useContext(AddEntryContext);
}

interface ScrollProps {
	onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
	scrollEventThrottle?: number;
}

const NO_SCROLL_PROPS: ScrollProps = {};

/**
 * Spread onto a scrolling list so the Android floating button follows it
 * (Material 3 extended FAB): the label folds away while the list scrolls
 * down and returns on the way up. Nothing on iOS and outside a provider.
 */
export function useAddButtonScroll(): ScrollProps {
	const add = useOptionalAddEntry();
	const last = useRef(0);
	const setExpanded = add?.setButtonExpanded;
	const active = Platform.OS === "android" && setExpanded !== undefined;
	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const offset = event.nativeEvent.contentOffset.y;
			const before = last.current;
			last.current = offset;
			setExpanded?.((current) => nextExpanded(current, offset, before));
		},
		[setExpanded],
	);
	// A list that goes away takes its fold with it.
	useEffect(() => {
		if (!active) return;
		return () => setExpanded?.(true);
	}, [active, setExpanded]);
	return useMemo(
		() => (active ? { onScroll, scrollEventThrottle: 16 } : NO_SCROLL_PROPS),
		[active, onScroll],
	);
}

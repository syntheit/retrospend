import { useFocusEffect } from "expo-router";
import { createContext, useCallback, useContext } from "react";
import { Platform } from "react-native";
import type { ComposerPrefill } from "@/surfaces/prefill";
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

/**
 * A pushed detail page: Android has no floating add button there (the page
 * has its own actions); iOS keeps it.
 */
export function useHideAddButtonOnDetail(): void {
	useHideAddButton(Platform.OS === "android");
}

/** Like useAddEntry, but null outside a provider (the gallery has none). */
export function useOptionalAddEntry(): AddEntryApi | null {
	return useContext(AddEntryContext);
}

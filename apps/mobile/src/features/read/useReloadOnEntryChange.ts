import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { subscribeEntryChanges } from "@/features/entry/events";

/**
 * Reload when an entry was added, undone or sent from the outbox, but only
 * while this screen is the one in front. A tab kept warm behind another, or a
 * list under a detail screen, skips it: the entry announcement ended the
 * freshness of every read, so the screen asks again when it regains focus.
 */
export function useReloadOnEntryChange(reload: () => unknown): void {
	const focused = useRef(true);
	useFocusEffect(
		useCallback(() => {
			focused.current = true;
			return () => {
				focused.current = false;
			};
		}, []),
	);
	useEffect(
		() =>
			subscribeEntryChanges(() => {
				if (focused.current) void reload();
			}),
		[reload],
	);
}

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { type CacheKey, loadCached, type ReadState } from "./loadCached";

/**
 * One cached read for a screen: the cache first, then the server, and again
 * each time the screen comes back into focus (after a payment on another
 * screen, or a swipe back from a person). `key.name` decides what is read;
 * `fetch` may change between renders. Pass null to wait for the server.
 */
export function useCachedRead<T>(
	key: CacheKey | null,
	fetch: (() => Promise<T>) | null,
): { state: ReadState<T>; reload: () => Promise<void> } {
	const { local } = useSession();
	const [state, setState] = useState<ReadState<T>>({ status: "loading" });
	const latest = useRef({ key, fetch });
	latest.current = { key, fetch };
	const alive = useRef(true);
	const name = key?.name;

	const reload = useCallback(async () => {
		const { key, fetch } = latest.current;
		if (!local || !key || !fetch) return;
		// An answer for a key the screen has moved off is dropped.
		const current = () =>
			alive.current && latest.current.key?.name === key.name;
		const next = await loadCached(local.cache, key, fetch, (cached) => {
			if (current()) setState(cached);
		});
		if (current()) setState(next);
	}, [local]);

	// A different read (another person, another filter) starts from loading.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `name` is the trigger
	useEffect(() => {
		alive.current = true;
		setState({ status: "loading" });
		return () => {
			alive.current = false;
		};
	}, [name, local]);

	// Runs on mount and on every return to the screen.
	useFocusEffect(
		// biome-ignore lint/correctness/useExhaustiveDependencies: `name` is the trigger
		useCallback(() => {
			reload();
		}, [reload, name]),
	);

	return { state, reload };
}

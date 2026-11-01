import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { type CacheKey, loadCached, type ReadState } from "./loadCached";

/**
 * The last answer of each read in this run, per account store. A screen that
 * mounts again (a segment switch remounts its list) starts from it instead of
 * from a skeleton, then refreshes; the disk cache answers too late for the
 * first frame.
 */
const lastReady = new WeakMap<object, Map<string, ReadState<unknown>>>();

function remembered<T>(
	store: object | null | undefined,
	name: string | undefined,
): ReadState<T> | null {
	if (!store || !name) return null;
	const seen = lastReady.get(store)?.get(name);
	return seen?.status === "ready"
		? { ...(seen as ReadState<T> & { status: "ready" }), refreshing: true }
		: null;
}

function remember(
	store: object | null | undefined,
	name: string | undefined,
	state: ReadState<unknown>,
) {
	if (!store || !name || state.status !== "ready") return;
	let names = lastReady.get(store);
	if (!names) {
		names = new Map();
		lastReady.set(store, names);
	}
	names.set(name, state);
}

/**
 * One cached read for a screen: the cache first, then the server, and again
 * each time the screen comes back into focus (after a payment on another
 * screen, or a swipe back from a person). `key.name` decides what is read;
 * `fetch` may change between renders. Pass null to wait for the server.
 * With no local store yet (offline with no cached profile) the read goes to
 * the server alone, so the screen shows data or an error, never nothing.
 * `prune` caps a family of per-entity entries (every person, every expense).
 */
export function useCachedRead<T>(
	key: CacheKey | null,
	fetch: (() => Promise<T>) | null,
	prune?: { prefix: string; keep: number },
): { state: ReadState<T>; reload: () => Promise<void> } {
	const { local } = useSession();
	const [state, setState] = useState<ReadState<T>>(
		() => remembered<T>(local?.cache, key?.name) ?? { status: "loading" },
	);
	const latest = useRef({ key, fetch, prune });
	latest.current = { key, fetch, prune };
	const alive = useRef(true);
	const name = key?.name;

	const reload = useCallback(async () => {
		const { key, fetch, prune } = latest.current;
		if (!key || !fetch) return;
		// An answer for a key the screen has moved off is dropped.
		const current = () =>
			alive.current && latest.current.key?.name === key.name;
		const next = await loadCached(
			local?.cache ?? null,
			key,
			fetch,
			(cached) => {
				if (current()) setState(cached);
			},
			prune,
		);
		remember(local?.cache, key.name, next);
		if (current()) setState(next);
	}, [local]);

	// A different read (another person, another filter) starts from what this
	// run last read for it, else from loading. The first run is the mount,
	// whose state already did.
	const mounted = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `name` is the trigger
	useEffect(() => {
		alive.current = true;
		if (mounted.current) {
			setState(
				remembered<T>(local?.cache, name) ?? { status: "loading" },
			);
		}
		mounted.current = true;
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

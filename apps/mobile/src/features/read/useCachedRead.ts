import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { type CacheKey, type ReadState, settle } from "./loadCached";
import { isFresh, loadShared } from "./readLedger";

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
 *
 * Coming back to a screen asks again only when its answer is older than
 * FRESH_MS or a write has reached the server since (a screen that was just
 * answered keeps what it shows); `reload` always asks. Two screens that read
 * the same thing at once send one request. `passive` is for a small control
 * that only needs the rows to exist (a picker's pins): it shows what this run
 * or the cache has, asks the server only when there is nothing, and never on
 * a return to focus.
 */
export function useCachedRead<T>(
	key: CacheKey | null,
	fetch: (() => Promise<T>) | null,
	prune?: { prefix: string; keep: number },
	options: { passive?: boolean } = {},
): { state: ReadState<T>; reload: () => Promise<void> } {
	const passive = options.passive === true;
	const { local } = useSession();
	const [state, setState] = useState<ReadState<T>>(
		() => remembered<T>(local?.cache, key?.name) ?? { status: "loading" },
	);
	const latest = useRef({ key, fetch, prune });
	latest.current = { key, fetch, prune };
	// What the screen shows and which read it belongs to (a new key starts
	// from its own rows in the effect below, a render later).
	const shown = useRef<{ state: ReadState<T>; name: string | undefined }>({
		state,
		name: key?.name,
	});
	const show = useCallback((next: ReadState<T>, name: string | undefined) => {
		if (shown.current.state === next && shown.current.name === name) return;
		shown.current = { state: next, name };
		setState(next);
	}, []);
	const alive = useRef(true);
	const name = key?.name;

	const load = useCallback(
		async (force: boolean) => {
			const { key, fetch, prune } = latest.current;
			if (!key || !fetch) return;
			const store = local?.cache ?? null;
			const own = shown.current.name === key.name ? shown.current.state : null;
			const have = own?.status === "ready";
			if (have && (passive || (!force && isFresh(store, key.name)))) return;
			// An answer for a key the screen has moved off is dropped.
			const current = () =>
				alive.current && latest.current.key?.name === key.name;
			const next = await loadShared(
				store,
				key,
				fetch,
				(cached) => {
					// Rows already on screen are newer than the cache's.
					if (current() && !have) show(cached, key.name);
				},
				prune,
				{ cachedIsEnough: passive },
			);
			remember(store, key.name, next);
			if (current()) {
				const now =
					shown.current.name === key.name ? shown.current.state : null;
				show(now ? settle(now, next) : next, key.name);
			}
		},
		[local, passive, show],
	);
	const reload = useCallback(() => load(true), [load]);

	// A different read (another person, another filter) starts from what this
	// run last read for it, else from loading. The first run is the mount,
	// whose state already did.
	const mounted = useRef(false);
	useEffect(() => {
		alive.current = true;
		if (mounted.current) {
			show(remembered<T>(local?.cache, name) ?? { status: "loading" }, name);
		}
		mounted.current = true;
		return () => {
			alive.current = false;
		};
	}, [name, local, show]);

	// Runs on mount and on every return to the screen.
	useFocusEffect(
		// biome-ignore lint/correctness/useExhaustiveDependencies: `name` is the trigger
		useCallback(() => {
			load(false);
		}, [load, name]),
	);

	return { state, reload };
}

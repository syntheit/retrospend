import type { ReadCache } from "@/data/cache";
import { type CacheKey, loadCached, type ReadState } from "./loadCached";

// What the phone already knows about its reads, shared by every screen:
// which read is on its way (so two screens asking for the same thing send one
// request) and when each was last answered (so coming back to a screen a few
// seconds later does not ask again). A write to the server ends both: any
// read answered before it is no longer fresh, and one still on its way is not
// joined by a read that starts after it.

/** A read answered this recently is not asked again when its screen regains focus. */
export const FRESH_MS = 20_000;

let generation = 0;

/** A write reached the server (or one is queued): every read is stale from now on. */
export function invalidateReads(): void {
	generation += 1;
}

interface Flight<T> {
	generation: number;
	cached: ReadState<T> | null;
	listeners: Set<(state: ReadState<T>) => void>;
	done: Promise<ReadState<T>>;
}

interface Ledger {
	flights: Map<string, Flight<unknown>>;
	answered: Map<string, { at: number; generation: number }>;
}

const ledgers = new WeakMap<object, Ledger>();
// Reads with no local store (offline with no cached profile) share this one.
const storeless: Ledger = { flights: new Map(), answered: new Map() };

function ledgerOf(store: object | null): Ledger {
	if (!store) return storeless;
	let ledger = ledgers.get(store);
	if (!ledger) {
		ledger = { flights: new Map(), answered: new Map() };
		ledgers.set(store, ledger);
	}
	return ledger;
}

/**
 * Whether `name` was answered by the server within `windowMs`, and no write
 * has reached the server since.
 */
export function isFresh(
	store: object | null,
	name: string,
	now: number = Date.now(),
	windowMs: number = FRESH_MS,
): boolean {
	const seen = ledgerOf(store).answered.get(name);
	return (
		seen !== undefined &&
		seen.generation === generation &&
		now - seen.at < windowMs
	);
}

/**
 * Runs `run` once for everyone asking for `name` at the same time. A caller
 * that arrives while it is on its way gets the cached rows it has already
 * shown (or will), and the same final answer. A read that starts after a
 * write never joins one that started before it.
 */
export function coalesce<T>(
	store: object | null,
	name: string,
	onCached: (state: ReadState<T>) => void,
	run: (onCached: (state: ReadState<T>) => void) => Promise<ReadState<T>>,
): Promise<ReadState<T>> {
	const ledger = ledgerOf(store);
	const open = ledger.flights.get(name) as unknown as Flight<T> | undefined;
	if (open && open.generation === generation) {
		if (open.cached) onCached(open.cached);
		else open.listeners.add(onCached);
		return open.done;
	}
	const flight: Flight<T> = {
		generation,
		cached: null,
		listeners: new Set([onCached]),
		done: Promise.resolve({ status: "loading" }),
	};
	const shared = flight as unknown as Flight<unknown>;
	ledger.flights.set(name, shared);
	flight.done = run((state) => {
		flight.cached = state;
		for (const listener of flight.listeners) listener(state);
		flight.listeners.clear();
	}).finally(() => {
		if (ledger.flights.get(name) === shared) {
			ledger.flights.delete(name);
		}
	});
	return flight.done;
}

/** `loadCached` for a screen: one request per read at a time, and it notes when the server answered. */
export function loadShared<T>(
	cache: ReadCache | null,
	key: CacheKey,
	fetch: () => Promise<T>,
	onCached: (state: ReadState<T>) => void,
	prune?: { prefix: string; keep: number },
	options?: { cachedIsEnough?: boolean },
): Promise<ReadState<T>> {
	return coalesce(cache, key.name, onCached, async (early) => {
		const started = generation;
		let fromCache = false;
		const next = await loadCached(
			cache,
			key,
			fetch,
			(state) => {
				fromCache = true;
				early(state);
			},
			prune,
			options,
		);
		// A read the cache answered alone never asked the server.
		const asked = !(options?.cachedIsEnough && fromCache);
		if (asked && next.status === "ready" && next.staleSince === null) {
			ledgerOf(cache).answered.set(key.name, {
				at: Date.now(),
				generation: started,
			});
		}
		return next;
	});
}

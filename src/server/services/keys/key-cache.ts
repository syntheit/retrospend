/**
 * The in-process keyring cache entry both key services use (docs/roadmap/
 * e2ee-d11-pr3.md section 1.3). An entry holds the load's promise, so
 * concurrent callers share one keystore query. A keyring is reused for five
 * minutes, so a rotation (a key added by D12) reaches every process; no key,
 * or a failure, only for 30 seconds, so a key made or a grant restored
 * elsewhere is seen soon. The entry is tied to the master keyring it was
 * unwrapped with.
 */
import type { Keyring } from "../../crypto/field-crypto";

export const RING_TTL_MS = 5 * 60 * 1000;
export const MISS_TTL_MS = 30 * 1000;

export interface CachedRing {
	readonly master: Keyring;
	readonly at: number;
	ttl: number;
	readonly ring: Promise<Keyring | undefined>;
}

export function cacheRing(
	master: Keyring,
	at: number,
	ring: Promise<Keyring | undefined>,
): CachedRing {
	const entry: CachedRing = { master, at, ttl: RING_TTL_MS, ring };
	ring.then(
		(found) => {
			if (!found) entry.ttl = MISS_TTL_MS;
		},
		() => {
			entry.ttl = MISS_TTL_MS;
		},
	);
	return entry;
}

export const isFresh = (
	entry: CachedRing | undefined,
	master: Keyring,
	now: number,
): entry is CachedRing =>
	entry !== undefined && entry.master === master && now - entry.at < entry.ttl;
